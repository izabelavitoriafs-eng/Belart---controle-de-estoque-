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
| Importação do OpenCV | Testado |
| ESP32: Wi-Fi, HX711 e conexão ao broker | Testado (Monitor Serial) |
| Captura da câmera pelo OpenCV | Pendente: janela com imagem preta |
| Reconhecimento pelo YOLO-World | Implementado, não validado |
| Python → ESP32 via MQTT | Implementado, não validado |
| Cálculo de quantidade (`set_scale(420.0)`) | Implementado, calibração de simulação não conferida |
| ESP32 → broker → aplicativo | Pendente |
| Fluxo completo | Pendente |

### Pendências conhecidas

- `src/main.cpp` ainda contém o peso do azulejo, categoria retirada do escopo (aguardando ajuste pelo responsável do firmware).
- Quando o Python publica `Nenhum`, o ESP32 passa a publicar quantidade `0`; a ausência momentânea de detecção não deveria zerar o estoque.
- Por ser um broker público, mensagens de terceiros podem chegar nos mesmos tópicos.

## Equipe

- Visão computacional (Python) e integração MQTT
- Firmware do ESP32 (C++) e sensores HX711
- Aplicativo React Native
