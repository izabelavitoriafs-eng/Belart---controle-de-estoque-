"""
Belart Smart Stock - Teste de integracao MQTT (sem camera)

Simula o que o camera.py publica e mostra o que o ESP32 responde.

1. Assina belart/#: recebe de volta o que o proprio Python publica
   (prova que o broker recebeu) e o que o ESP32 publica em belart/estoque.
2. Publica um produto em cada topico de visao (belart/visao/prateleira1..3)
   a cada 3 segundos, como o camera.py faz continuamente.
3. Durante 30 segundos, imprime tudo o que o ESP32 publicar.

Execute com a simulacao do Wokwi RODANDO:
    python python/teste_mqtt.py
"""
import threading
import time
import paho.mqtt.client as mqtt

BROKER_MQTT = "broker.hivemq.com"
PORTA_MQTT = 1883

# Produto que sera "detectado" em cada prateleira neste teste
PRODUTOS_TESTE = {
    1: "Caneca",
    2: "Garrafa",
    3: "Caneca",
}

TOPICO_VISAO = "belart/visao/prateleira{}"
TOPICO_ESTOQUE = "belart/estoque/prateleira{}"

TEMPO_ESCUTA = 30  # segundos
INTERVALO_PUBLICACAO = 3  # segundos
TEMPO_MAX_CONEXAO = 15  # segundos

conectado = threading.Event()


def ao_conectar(client, userdata, flags, reason_code, properties=None):
    print(f"Conectado ao broker (codigo: {reason_code})")
    # belart/# inclui os topicos de visao (eco do proprio Python) e de estoque (ESP32)
    client.subscribe("belart/#")
    print("Inscrito em belart/# (visao + estoque)\n")
    conectado.set()


def ao_receber(client, userdata, msg):
    texto = msg.payload.decode("utf-8", errors="replace")

    if msg.topic.startswith("belart/visao/"):
        # Eco: prova que o broker recebeu o que o Python publicou
        print(f"[broker -> Python] {msg.topic} | Eco recebido: {texto}")
        return

    partes = texto.split(",")

    if len(partes) == 2:
        produto, quantidade = partes
        print(f"[ESP32 -> broker] {msg.topic} | Produto: {produto} | Quantidade: {quantidade}")
    else:
        print(f"[ESP32 -> broker] {msg.topic} | Formato inesperado: {texto!r}")


# Compativel com paho-mqtt 1.x e 2.x
try:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
except AttributeError:
    client = mqtt.Client()

client.on_connect = ao_conectar
client.on_message = ao_receber

client.connect(BROKER_MQTT, PORTA_MQTT, 60)
client.loop_start()

# Espera a confirmacao real da conexao antes de publicar
if not conectado.wait(TEMPO_MAX_CONEXAO):
    print(f"Nao conectou ao broker em {TEMPO_MAX_CONEXAO} segundos. Verifique a internet.")
    client.loop_stop()
    raise SystemExit(1)
time.sleep(1)  # margem para o broker registrar as inscricoes

def publicar_produtos():
    for id_prateleira, produto in PRODUTOS_TESTE.items():
        topico = TOPICO_VISAO.format(id_prateleira)
        resultado = client.publish(topico, produto)
        status = "OK" if resultado.rc == mqtt.MQTT_ERR_SUCCESS else f"ERRO {resultado.rc}"
        print(f"[Python -> broker] {topico} | Produto: {produto} | {status}")


# Publica repetidamente, como o camera.py faz a cada 15 quadros.
# Assim o ESP32 recebe mesmo que conecte depois do inicio do teste.
print(f"Publicando a cada {INTERVALO_PUBLICACAO} s durante {TEMPO_ESCUTA} s...\n")
inicio = time.time()
while time.time() - inicio < TEMPO_ESCUTA:
    publicar_produtos()
    time.sleep(INTERVALO_PUBLICACAO)

client.loop_stop()
client.disconnect()
print("\nTeste encerrado. Copie e cole toda a saida acima na conversa.")
