
# BIBLIOTECAS

import time

import cv2
import paho.mqtt.client as mqtt
from ultralytics import YOLOWorld


# CONFIGURAÇÃO MQTT

BROKER_MQTT = "broker.hivemq.com"
PORTA_MQTT = 1883

TOPICOS = {
    1: "belart/visao/prateleira1",
    2: "belart/visao/prateleira2",
    3: "belart/visao/prateleira3"
}

# Cria o cliente MQTT
client_mqtt = mqtt.Client()

# Conexão com o broker
try:
    client_mqtt.connect(BROKER_MQTT, PORTA_MQTT, 60)
    client_mqtt.loop_start()
    print("Conectado ao Broker MQTT!")

except Exception as e:
    print(f"Erro ao conectar ao MQTT: {e}")
    raise SystemExit(1)


# CARREGAMENTO DO YOLO-WORLD

print("Carregando modelo YOLO-World...")

model = YOLOWorld("yolov8s-world.pt")

CLASSES_BUSCADAS = [
    "mug",
    "bottle",
]

TRADUCAO_CLASSES = {
    "mug": "Caneca",
    "bottle": "Garrafa",
}

model.set_classes(CLASSES_BUSCADAS)

print("Modelo carregado com sucesso!")


# IDENTIFICAÇÃO DA PRATELEIRA PELA POSIÇÃO VERTICAL

def identificar_prateleira(y_centro, altura_imagem):

    terco = altura_imagem / 3

    if y_centro < terco:
        return 1  # Prateleira de cima

    elif y_centro < terco * 2:
        return 2  # Prateleira do meio

    else:
        return 3  # Prateleira de baixo


# FUNÇÃO PARA TRADUZIR A CLASSE DETECTADA

def traduzir_classe(nome_classe):

    nome_classe = str(nome_classe).lower()

    return TRADUCAO_CLASSES.get(nome_classe, nome_classe)


# IDENTIFICAÇÃO DOS PRODUTOS E SUAS PRATELEIRAS

def identificar_prateleiras(resultado, altura_imagem):

    deteccoes = {
        1: None,
        2: None,
        3: None
    }

    boxes = resultado.boxes
    nomes_classes = resultado.names

    for box in boxes:

        # Recupera o ID e a confiança da classe
        class_id = int(box.cls[0].item())
        confianca = float(box.conf[0].item())

        # Recupera o nome da classe
        nome_ingles = nomes_classes[class_id]

        # Traduz o nome para português
        nome_portugues = traduzir_classe(nome_ingles)

        # Recupera as coordenadas da caixa delimitadora
        x1, y1, x2, y2 = box.xyxy[0].tolist()

        # Calcula o centro vertical do objeto
        centro_y = (y1 + y2) / 2

        # Descobre a qual prateleira o objeto pertence
        id_prateleira = identificar_prateleira(
            centro_y,
            altura_imagem
        )

        # Verifica se já existe uma detecção nessa prateleira
        deteccao_atual = deteccoes[id_prateleira]

        # Mantém a detecção com maior confiança
        if (
            deteccao_atual is None
            or confianca > deteccao_atual["confianca"]
        ):

            # Posição do centro em % da imagem (diagnóstico)
            altura_orig, largura_orig = resultado.orig_shape[:2]

            deteccoes[id_prateleira] = {
                "classe": nome_portugues,
                "confianca": confianca,
                "pos_x": ((x1 + x2) / 2) / largura_orig,
                "pos_y": centro_y / altura_orig
            }

    return deteccoes


# CONEXÃO COM A CÂMERA

camera = cv2.VideoCapture(0, cv2.CAP_DSHOW)

if not camera.isOpened():

    print("Erro: nao foi possivel acessar a camera.")

    client_mqtt.loop_stop()
    client_mqtt.disconnect()

    raise SystemExit(1)

print("Camera conectada com sucesso!")
print("Mostre os produtos para a camera.")
print("Pressione Q para encerrar.")


# VARIÁVEIS DE CONTROLE

# Publica a cada 1 segundo, independente de quantos quadros por segundo
# a câmera e o YOLO conseguem processar (antes: a cada 15 quadros, o que
# podia levar vários segundos com o YOLO rodando no processador).
INTERVALO_PUBLICACAO_SEGUNDOS = 1.0

ultima_publicacao = 0.0

# Quantos ciclos de publicação seguidos sem detecção são necessários
# para confirmar "Nenhum" (3 ciclos x 1 s = cerca de 3 segundos).
# Evita que uma perda momentânea da câmera zere o estoque no ESP32.
CICLOS_PARA_CONFIRMAR_NENHUM = 3

ciclos_sem_deteccao = {
    1: 0,
    2: 0,
    3: 0
}


# EXECUÇÃO CONTÍNUA DA CÂMERA E DA IA

try:

    while True:

        # Captura uma imagem da câmera
        sucesso, imagem = camera.read()

        if not sucesso:
            print("Erro ao receber imagem da camera.")
            break

        # Recupera a altura da imagem
        altura, largura = imagem.shape[:2]

        # Executa a identificação dos objetos
        resultados = model.predict(
            imagem,
            verbose=False,
            conf=0.4
        )

        resultado = resultados[0]

        # Desenha as caixas dos objetos identificados
        imagem_anotada = resultado.plot()

        # Identifica os produtos e suas respectivas prateleiras
        deteccoes = identificar_prateleiras(
            resultado,
            altura
        )

        # PUBLICAÇÃO DOS RESULTADOS NO MQTT

        agora = time.time()

        if agora - ultima_publicacao >= INTERVALO_PUBLICACAO_SEGUNDOS:

            ultima_publicacao = agora

            for id_prateleira in (1, 2, 3):

                deteccao = deteccoes[id_prateleira]

                if deteccao is not None:

                    # Produto identificado na prateleira
                    mensagem = deteccao["classe"]
                    confianca = deteccao["confianca"]
                    ciclos_sem_deteccao[id_prateleira] = 0

                else:

                    ciclos_sem_deteccao[id_prateleira] += 1
                    ciclos = ciclos_sem_deteccao[id_prateleira]

                    if ciclos < CICLOS_PARA_CONFIRMAR_NENHUM:

                        # Ausência momentânea: não publica, e o ESP32
                        # mantém o último produto válido da prateleira
                        print(
                            f"[YOLO] Prateleira {id_prateleira} "
                            f"| Sem deteccao ({ciclos}/"
                            f"{CICLOS_PARA_CONFIRMAR_NENHUM}) "
                            f"| Mantendo ultimo produto"
                        )
                        continue

                    # Ausência confirmada
                    mensagem = "Nenhum"
                    confianca = 0.0

                # Recupera o tópico correspondente
                topico = TOPICOS[id_prateleira]

                # Publica a mensagem no MQTT
                resultado_mqtt = client_mqtt.publish(
                    topico,
                    mensagem
                )

                if resultado_mqtt.rc == mqtt.MQTT_ERR_SUCCESS:

                    # Posição na imagem: 0% = topo/esquerda, 100% = base/direita.
                    # Prateleira 1: Y < 33% | 2: 33% a 66% | 3: Y > 66%
                    posicao = ""
                    if deteccao is not None:
                        posicao = (
                            f" | Posicao X: {deteccao['pos_x']:.0%}"
                            f" Y: {deteccao['pos_y']:.0%}"
                        )

                    print(
                        f"[YOLO -> MQTT] Prateleira {id_prateleira} "
                        f"| Produto: {mensagem} "
                        f"| Confianca: {confianca:.2f}"
                        f"{posicao}"
                    )

                else:

                    print(
                        f"Erro ao publicar na prateleira "
                        f"{id_prateleira}"
                    )

        # EXIBIÇÃO DA CÂMERA

        cv2.imshow(
            "Belart Smart Stock - Camera",
            imagem_anotada
        )

        # Verifica se a tecla Q foi pressionada
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break


# FINALIZAÇÃO

finally:

    camera.release()

    cv2.destroyAllWindows()

    client_mqtt.loop_stop()

    client_mqtt.disconnect()

    print("Camera encerrada.")