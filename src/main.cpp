#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "HX711.h"

// Configuração do Broker (A ponte pra troca de info) MQTT Público
const char *BROKER_MQTT = "broker.hivemq.com";
const int PORTA_MQTT = 1883;

// Configuração Wi-Fi (No Wokwi a rede padrão é Wokwi-GUEST sem senha)
const char *SSID_WIFI = "Wokwi-GUEST";
const char *SENHA_WIFI = "";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Sensores da prateleira 1
#define Prateleira1_HX711_DT 19
#define Prateleira1_HX711_SCK 18
// Sensores da prateleira 2
#define Prateleira2_HX711_DT 21
#define Prateleira2_HX711_SCK 22
// Sensores da prateleira 3
#define Prateleira3_HX711_DT 25
#define Prateleira3_HX711_SCK 26

// Fator de escala em gramas (ver setup)
const float ESCALA_GRAMAS = 21000.0 / 50000.0; // 0.42

HX711 balancaPrateleira1;
HX711 balancaPrateleira2;
HX711 balancaPrateleira3;

// Estrutura dinâmica da prateleira baseada no que o Python determinar
struct Prateleira
{
  int id;
  String itemDetectadoIA; // Item que a IA no Python determinou para a prateleira
  float pesoUnitario;     // Peso de referência dinâmico em gramas
  int unidadesContadas;   // Quantidade calculada pela balança
};

// Instâncias das 3 prateleiras (Iniciam aguardando leitura do Python)
Prateleira prateleira1 = {1, "Aguardando IA...", 0.0, 0};
Prateleira prateleira2 = {2, "Aguardando IA...", 0.0, 0};
Prateleira prateleira3 = {3, "Aguardando IA...", 0.0, 0};

// Função auxiliar para definir o peso unitário com base no item detectado pelo Python
float obterPesoUnitario(String item)
{
  if (item == "Caneca")
    return 352.0;
  if (item == "Garrafa")
    return 500.0;
  return 0.0; // Se o item for desconhecido ou não cadastrado
}

// =================================================================================
// CALLBACK MQTT: RECEBE AS DETECÇÕES DO SCRIPT PYTHON EM TEMPO REAL
// =================================================================================
void callbackMQTT(char *topic, byte *payload, unsigned int length)
{
  String mensagem = "";
  for (unsigned int i = 0; i < length; i++)
  {
    mensagem += (char)payload[i];
  }

  String topico = String(topic);

  // IA envia leitura direta do Python para cada prateleira
  if (topico == "belart/visao/prateleira1")
  {
    prateleira1.itemDetectadoIA = mensagem;
    prateleira1.pesoUnitario = obterPesoUnitario(mensagem);
  }
  else if (topico == "belart/visao/prateleira2")
  {
    prateleira2.itemDetectadoIA = mensagem;
    prateleira2.pesoUnitario = obterPesoUnitario(mensagem);
  }
  else if (topico == "belart/visao/prateleira3")
  {
    prateleira3.itemDetectadoIA = mensagem;
    prateleira3.pesoUnitario = obterPesoUnitario(mensagem);
  }
}

// Conecta ao Wi-Fi e ao Broker MQTT
void conectarMQTT()
{
  // ID único por inicialização: no broker público, dois clientes com o mesmo ID
  // derrubam um ao outro. No Wokwi, todas as simulações têm o mesmo MAC,
  // por isso o sufixo é aleatório.
  static String idCliente = "Belart_ESP32_" + String((unsigned long)random(0xFFFFFF), HEX);

  while (!mqttClient.connected())
  {
    Serial.print("Conectando ao MQTT Broker como ");
    Serial.print(idCliente);
    Serial.print("...");
    if (mqttClient.connect(idCliente.c_str()))
    {
      Serial.println(" Conectado!");
      // Inscreve-se nos tópicos publicados pelo script Python
      mqttClient.subscribe("belart/visao/prateleira1");
      mqttClient.subscribe("belart/visao/prateleira2");
      mqttClient.subscribe("belart/visao/prateleira3");
    }
    else
    {
      Serial.print("Falha na conexão, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" Tentando em 5 segundos...");
      delay(5000);
    }
  }
}

// =================================================================================
// FUNÇÃO REUTILIZÁVEL DE CONTAGEM BASEADA NO RETORNO DO PYTHON
// =================================================================================
int contarUnidades(HX711 &balanca, Prateleira &p)
{
  if (balanca.is_ready())
  {
    Serial.print("⚠️ Prateleira: [");
    Serial.print(p.id);
    Serial.print("] Item Detectado pelo Python: ");
    Serial.println(p.itemDetectadoIA);

    // Lê o peso calibrado em gramas (Média de 3 medições)
    float pesoAtual = balanca.get_units(3);
    if (pesoAtual < 0)
      pesoAtual = 0.0;

    int unidades = 0;

    // Se o Python já detectou um item válido com peso cadastrado
    if (p.pesoUnitario > 0)
    {
      unidades = round(pesoAtual / p.pesoUnitario);
    }

    Serial.print("Peso Lido: ");
    Serial.print(pesoAtual, 1);
    Serial.print("g | Qtd Calculada: ");
    Serial.print(unidades);
    Serial.println(" uni");

    p.unidadesContadas = unidades;

    // Publica o estado atualizado no MQTT para o App (Item, Qtd)
    String payloadPub = p.itemDetectadoIA + "," + String(unidades);
    String topicoPub = "belart/estoque/prateleira" + String(p.id);
    if (!mqttClient.publish(topicoPub.c_str(), payloadPub.c_str()))
    {
      Serial.print("Falha ao publicar em ");
      Serial.print(topicoPub);
      Serial.print(" | estado MQTT: ");
      Serial.println(mqttClient.state());
    }

    return unidades;
  }
  else
  {
    Serial.print("Aguardando leitura do HX711 da Prateleira ");
    Serial.println(p.id);
    return 0;
  }
}

// Faz a tara somente se o HX711 responder em até 1 segundo.
// Sem essa verificação, tare() espera indefinidamente e o ESP32 trava no setup().
void tararBalanca(HX711 &balanca, int idPrateleira)
{
  if (balanca.wait_ready_timeout(1000))
  {
    balanca.tare();
    Serial.print("Tara concluida na Prateleira ");
    Serial.println(idPrateleira);
  }
  else
  {
    Serial.print("HX711 da Prateleira ");
    Serial.print(idPrateleira);
    Serial.println(" nao respondeu (tara nao realizada)");
  }
}

void setup()
{
  Serial.begin(115200);
  delay(1000);

  Serial.println("================================");
  Serial.println("BELART - CONTROLE DE ESTOQUE");
  Serial.println("================================");

  // Conexão Wi-Fi
  WiFi.begin(SSID_WIFI, SENHA_WIFI);
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi Conectado!");

  // Configura MQTT
  mqttClient.setServer(BROKER_MQTT, PORTA_MQTT);
  mqttClient.setCallback(callbackMQTT);

  // Inicializa os sensores HX711
  balancaPrateleira1.begin(Prateleira1_HX711_DT, Prateleira1_HX711_SCK);
  balancaPrateleira2.begin(Prateleira2_HX711_DT, Prateleira2_HX711_SCK);
  balancaPrateleira3.begin(Prateleira3_HX711_DT, Prateleira3_HX711_SCK);

  Serial.println("Sensores HX711 iniciados!");

  // Escala para o HX711 "50kg" do Wokwi: leitura bruta de 0 a 21000 para 0 a 50 kg.
  // 21000 / 50000 g = 0.42 -> get_units() retorna o peso em GRAMAS.
  // (Com 420.0 o resultado saia em quilos e a quantidade ficava sempre perto de 0.)
  balancaPrateleira1.set_scale(ESCALA_GRAMAS);
  tararBalanca(balancaPrateleira1, 1);

  balancaPrateleira2.set_scale(ESCALA_GRAMAS);
  tararBalanca(balancaPrateleira2, 2);

  balancaPrateleira3.set_scale(ESCALA_GRAMAS);
  tararBalanca(balancaPrateleira3, 3);

  Serial.println("Configuracao das balancas concluida!");
}

void loop()
{
  // Garante reconexão contínua ao Broker
  if (!mqttClient.connected())
  {
    conectarMQTT();
  }
  mqttClient.loop(); // Processa mensagens MQTT do Python em tempo real

  // Processamento e publicação do estoque
  contarUnidades(balancaPrateleira1, prateleira1);
  Serial.println("=======================================================");

  contarUnidades(balancaPrateleira2, prateleira2);
  Serial.println("=======================================================");

  contarUnidades(balancaPrateleira3, prateleira3);
  Serial.println("=======================================================");

  delay(1000); // Intervalo de atualização
}