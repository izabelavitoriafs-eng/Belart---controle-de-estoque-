# Belart Smart Stock

Sistema acadêmico de controle inteligente de estoque (curso de Análise e Desenvolvimento de Sistemas), baseado na realidade da Belart, loja de produtos personalizados.

O sistema combina **visão computacional**, **sensores de peso simulados** e **comunicação MQTT** para estimar a quantidade de produtos em três prateleiras.

> **Projeto em desenvolvimento.** Os sensores HX711 e o ESP32 são **simulados no Wokwi**; não há hardware físico instalado na loja.

## Produtos

| Categoria (YOLO-World) | Produto | Peso unitário configurado |
|---|---|---:|
| `mug` | Caneca | 352 g |
| `bottle` | Garrafa | 500 g |

São **três prateleiras** e **duas categorias** de produto.

## Arquitetura

```text
Câmera → Python (OpenCV + YOLO-World) → MQTT → ESP32 + HX711 (Wokwi) → MQTT → App React Native
```

Toda a comunicação passa pelo broker público `broker.hivemq.com`. Não há conexão direta entre ESP32 e aplicativo.

1. O Python captura a imagem, identifica o produto e a prateleira (pelo terço vertical da imagem em que está o centro do objeto) e publica o nome do produto.
2. O ESP32 recebe o produto, lê o peso do HX711 da prateleira e calcula `quantidade = peso / peso unitário`.
3. O ESP32 publica `Produto,Quantidade` (ex.: `Caneca,5`).
4. O aplicativo assina os tópicos de estoque e exibe as três prateleiras.

### Tópicos MQTT

| Origem → Destino | Tópicos | Mensagem |
|---|---|---|
| Python → ESP32 | `belart/visao/prateleira1`, `belart/visao/prateleira2`, `belart/visao/prateleira3` | `Caneca`, `Garrafa` ou `Nenhum` |
| ESP32 → App | `belart/estoque/prateleira1`, `belart/estoque/prateleira2`, `belart/estoque/prateleira3` | `Caneca,5` |

Portas: TCP `1883` (Python e ESP32) e WebSocket `wss://broker.hivemq.com:8884/mqtt` (aplicativo). Os tópicos diferenciam maiúsculas de minúsculas.

## Estrutura do repositório

```text
python/
  camera.py        # visão computacional e publicação MQTT
  teste_mqtt.py    # teste do MQTT sem câmera (Python <-> broker <-> ESP32)
  teste.py         # teste simples do interpretador
src/
  main.cpp         # firmware do ESP32 (Wi-Fi, MQTT, HX711)
platformio.ini     # configuração do PlatformIO (esp32dev, Arduino)
diagram.json       # circuito do Wokwi (ESP32 + 3 HX711)
wokwi.toml         # aponta para o firmware compilado
```

O aplicativo React Native está sendo desenvolvido por outros colaboradores e será adicionado depois.

## Como executar

### Python (Windows)

```bash
python -m pip install opencv-python ultralytics paho-mqtt numpy
python python/camera.py
```

Execute **a partir da raiz do projeto**. Na primeira execução, a Ultralytics baixa automaticamente `yolov8s-world.pt` e o modelo CLIP (por isso esses arquivos não ficam no repositório). Pressione `Q` para encerrar.

### ESP32 no Wokwi

1. Instale no VS Code as extensões **PlatformIO IDE** e **Wokwi Simulator**.
2. Compile com `PlatformIO: Build` (gera `.pio/build/esp32dev/firmware.bin`).
3. Abra o `diagram.json` e inicie a simulação (`Wokwi: Start Simulator`).
4. Acompanhe o Monitor Serial e ajuste o peso de cada HX711 no simulador.

## Situação atual

| Etapa | Situação |
|---|---|
| Captura da câmera pelo OpenCV | Validado |
| Reconhecimento de Caneca e Garrafa (YOLO-World) | Validado |
| Identificação da prateleira pela posição na imagem | Validado (depende do enquadramento da câmera) |
| Python → broker → ESP32 | Validado |
| Peso em gramas e cálculo da quantidade no Wokwi | Validado (10,2 kg de canecas → 29 unidades) |
| Ausência momentânea de detecção não zera o estoque | Validado |
| ESP32 → broker (`Produto,Quantidade`) | Validado com `teste_mqtt.py` |
| Aplicativo React Native recebendo e exibindo as prateleiras | Pendente |
| Fluxo completo até o aplicativo | Pendente |

### Comportamentos importantes

- **Escala do HX711:** o sensor `50kg` do Wokwi lê de 0 a 21000 para 0 a 50 kg; com `set_scale(21000 / 50000)` a leitura sai em gramas. 50 kg por prateleira é a capacidade máxima do Wokwi (cerca de 142 canecas ou 100 garrafas).
- **`Nenhum`:** só é publicado depois de 3 ciclos seguidos sem detecção (cerca de 3 segundos; o Python publica a cada 1 segundo). Antes disso, o ESP32 mantém o último produto válido da prateleira.
- **Prateleira:** o terminal do Python mostra a posição do objeto (`Posicao X/Y` em % da imagem). Prateleira 1: Y < 33%; 2: 33% a 66%; 3: Y > 66%. Use para ajustar o enquadramento da câmera.
- **ID MQTT do ESP32:** recebe um sufixo aleatório a cada inicialização (`Belart_ESP32_xxxxxx`), porque no broker público dois clientes com o mesmo ID derrubam um ao outro.
- Abra a simulação do Wokwi com todas as balanças em 0: a tara é feita na inicialização.

### Pendências conhecidas

- Integração com o aplicativo React Native.
- Por ser um broker público, mensagens de terceiros podem chegar nos mesmos tópicos.

## Equipe

- Visão computacional (Python) e integração MQTT
- Firmware do ESP32 (C++) e sensores HX711
- Aplicativo React Native
