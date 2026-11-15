import { StyleSheet, Text, View, Image, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useEffect, useState } from 'react';
import mqtt from 'mqtt';

const CardUser = ({ nome, nomeCompleto, statusOnline, cargo}) => {

  // Recebe o estado booleano dinâmico passado pela prop statusOnline
  const isOnline = statusOnline;

  // Define o texto que aparece no status de conexão
  const textoStatusOnline = isOnline ? "conectado ao sistema" : "não foi possível conectar";

  return(
    <View style={styles.cardUser}>

      <View style={styles.cardUserFlex1}>
        <Text style={styles.saudacoes}> BEM VINDO(A), </Text>
        <Text style={styles.nomeUser}> {nome}! </Text>
      </View>

      <View style={styles.cardUserFlex2}>
        <Text style={styles.nomeCompletoUser}> {nomeCompleto} </Text>
        <Text style={styles.cargo}> {cargo} </Text>

        <View style={[styles.statusOnline, isOnline ? styles.online : styles.offline]}>
          <View style={[styles.statusOnlineBolinhah, isOnline ? styles.bolinhaOnline : styles.bolinhaOffline]}>
            {/* Aqui, é a view que representa o indicador (bolinha) cromático do status de conexão */}
          </View>
          <Text style={[styles.textoStatus, isOnline ? styles.textoOnline : styles.textoOffline]}> {textoStatusOnline} </Text>
        </View>
      </View>

    </View>
  );

};

/** Produtos do Belart Smart Stock e estoque mínimo de cada um */
const PRODUTOS_VALIDOS = ['Caneca', 'Garrafa'];
const LIMITE_MINIMO = { Caneca: 30, Garrafa: 20 };

/** Estado inicial das prateleiras, antes de chegar a primeira mensagem do ESP32 */
const ESTADO_INICIAL = { item: 'Aguardando...', quantidade: 0 };

/** Card de estoque: recebe a prateleira, o produto e a quantidade publicados pelo ESP32 */
const CardEstoque = ({ prateleira, produto, quantidade }) => {

  // Só calcula o status quando o produto é Caneca ou Garrafa.
  // "Nenhum", "Aguardando IA..." ou sem dados mostram status neutro,
  // para não aparecer "Repor Estoque" quando apenas não há detecção.
  const temProduto = PRODUTOS_VALIDOS.includes(produto);
  const isCritico = temProduto && quantidade <= LIMITE_MINIMO[produto];

  // "Nenhum" vira um texto mais claro para o usuário
  const textoProduto = produto === 'Nenhum' ? 'Sem produto' : produto;

  let textoStatus = 'Aguardando dados';
  let estiloStatus = styles.statusNeutro;
  if (temProduto) {
    textoStatus = isCritico ? 'Repor Estoque' : 'Estoque OK';
    estiloStatus = isCritico ? styles.statusCritico : styles.statusOk;
  }

  return(
    <View style={styles.card}  >
      <View style={styles.caixa1Card}>
        <Text style={styles.tituloCard}>{prateleira}</Text>
        <Text style={styles.produtoCard}>{textoProduto}</Text>
          <Text style={styles.quantidadeProduto}>{quantidade} un.</Text>

          <View style={[styles.status, estiloStatus]}>
            <Text style={styles.statusTexto}>
              {textoStatus}
            </Text>
          </View>
      </View>
    </View>
  );
};

export default function App() {
  const [mqttClient, setMqttClient] = useState(null);
  const [isConectado, setIsConectado] = useState(false); // Estado da conexão MQTT

  // Cada prateleira guarda { item, quantidade } recebidos do ESP32
  const [prateleira1, setPrateleira1] = useState(ESTADO_INICIAL);
  const [prateleira2, setPrateleira2] = useState(ESTADO_INICIAL);
  const [prateleira3, setPrateleira3] = useState(ESTADO_INICIAL);

 // Conexão MQTT Integrada Belart Smart Stock
  useEffect(() => {
    const client = (mqtt.connect ? mqtt : mqtt.default).connect('wss://broker.hivemq.com:8884/mqtt');

    client.on('connect', () => {
      setMqttClient(client);
      setIsConectado(true); // Conectado com sucesso
      console.log('Conectado ao Broker MQTT do Belart!');

      // Inscrição nos tópicos das 3 prateleiras publicadas pelo ESP32
      client.subscribe('belart/estoque/prateleira1');
      client.subscribe('belart/estoque/prateleira2');
      client.subscribe('belart/estoque/prateleira3');
    });

    client.on('offline', () => {
      setIsConectado(false);
    });

    client.on('reconnect', () => {
      setIsConectado(false);
    });

    client.on('message', (topic, message) => {
      const payload = message.toString(); // Formato vindo do ESP32: "Produto,Quantidade" (ex.: "Caneca,5")
      const partes = payload.split(',');

      const itemDetectado = (partes[0] || 'Desconhecido').trim();
      const qtdCalculada = parseInt(partes[1], 10) || 0;

      if (topic === 'belart/estoque/prateleira1') {
        setPrateleira1({ item: itemDetectado, quantidade: qtdCalculada });
      } else if (topic === 'belart/estoque/prateleira2') {
        setPrateleira2({ item: itemDetectado, quantidade: qtdCalculada });
      } else if (topic === 'belart/estoque/prateleira3') {
        setPrateleira3({ item: itemDetectado, quantidade: qtdCalculada });
      }
    });

    return () => client.end();
  }, []);

  return (
    <ScrollView
    showsVerticalScrollIndicator={false} // Esconde a barra vertical
    style={styles.container}>

      <View style={styles.cabecalho} /* Cabeçalho flutuante do app */ >
        <View style={styles.caixaLogo}>
          <Image source={require('./assets/iconeBelaArt.png')} /* Aqui, vamos colocar a logo da BelartBH */ style={styles.logo} />
        </View>
        <View style={styles.caixaTitulos}>
          <Text style={styles.titulo}>
            Belart
          </Text>

          <View style={styles.linha} /**Aqui, vamos estilizar a linha que separa o título do subtítulo */></View>

          <Text style={styles.subTitulo}>
            Produros Personalizados
          </Text>
        </View>
      </View>

      <View style={styles.caixaUser}>
      {/** Aqui, temos o card de usuário repassando o estado de conexão em tempo real para o statusOnline */}
        <CardUser nome="ISABELA" nomeCompleto="ISABELA MOREIRA RAMOS DE ANDRADE" statusOnline={isConectado} cargo="Admin" />
      </View>

      <View style={styles.caixaCards}>
        {/** Cards alimentados em tempo real pelos tópicos belart/estoque/prateleira1, 2 e 3 (publicados pelo ESP32) */}
          <CardEstoque prateleira="Prateleira 1" produto={prateleira1.item} quantidade={prateleira1.quantidade} />
          <CardEstoque prateleira="Prateleira 2" produto={prateleira2.item} quantidade={prateleira2.quantidade} />
          <CardEstoque prateleira="Prateleira 3" produto={prateleira3.item} quantidade={prateleira3.quantidade} />
      </View>

    </ScrollView>
  );
}

const THEME = {
    colors: {
      fundo: '#641167',
      roxoClaro: '#641167',
      roxoEscuro: '#3d0d40',
      amareloTitulo: '#efa30f',
      amareloSubtitulo: '#b97006',
      preto: 'black',
      branco: 'white',
      cinza: 'grey',
    },

    shadow: {
      sombra: '0px 0px 8px 1px #3d0d40',
    },

    border: {
      bordaArredondada: 10,
    },

    tamanhoTextos: {
      tituloCabecalho: 50,
      subTituloCabecalho: 13,

      tituloCard: 18,
      produtoCard: 30,
      tituloQntProdutos: 22,
      textoStatus: 12,
    },
  }

/** vermelho: '#EF4444', verde: '#10B981' */
const STATUS = {
  colors: {
    vermelho: 'red',
    vermelhoTransparente: 'rgba(211, 47, 47, 0.30)',

    verde: 'green',
    verdeTransparente: 'rgba(46, 125, 50, 0.30)',

    cinzaTransparente: 'rgba(128, 128, 128, 0.30)',
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.fundo,
    padding: 8,
  },

  cabecalho: {
    backgroundColor: THEME.colors.roxoEscuro,
    marginTop: 2,
    paddingTop: 10,
    paddingRight: 0, /** Serve para centralizar o tótulo mantendo o padding da caixa de títulos */
    paddingBottom: 7,
    paddingLeft: 10,

    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',

    borderRadius: THEME.border.bordaArredondada,

    /** Sombra pra IOS */
    elevation: 8,
  },

  caixaLogo: {
    width: '30%',
    height: '95%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',


  },

  logo: {
    height: 120,
    width: 120,
  },

  caixaTitulos: {
    width: '70%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 10,
  },

  titulo: {
    width: '100%',
    textAlign: 'center',
    fontSize: THEME.tamanhoTextos.tituloCabecalho,
    color: THEME.colors.amareloTitulo,
  },

  linha: {
    height: 2,
    width: '80%',
    backgroundColor: THEME.colors.amareloTitulo,
  },

  subTitulo: {
    width: '100%',
    textAlign: 'center',
    fontSize: THEME.tamanhoTextos.subTituloCabecalho,
    color: THEME.colors.amareloSubtitulo,

    padding: 5,
  },

  // Parte do card de usuário

  cardUser: {
    backgroundColor: THEME.colors.roxoEscuro,
    borderRadius: THEME.border.bordaArredondada,
    padding: 10,
    marginTop: 20,
    elevation: 3, // Sombra Android
    shadowColor: '#000', // Sombra iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,

    width: '100%',

    borderBottomWidth: 2,
    borderColor: THEME.colors.amareloTitulo,
    borderStyle: 'solid',

    boxShadow: THEME.shadow.sombra,

  },

  cardUserFlex1: {
    display: 'flex',
    flexDirection: 'row',
  },

  saudacoes: {
    color: THEME.colors.amareloSubtitulo,
    fontSize: 11,
  },
  nomeUser: {
    color: THEME.colors.amareloSubtitulo,
    fontSize: 11,
  },

  cardUserFlex2: {
    display: 'flex',
    flexDirection: 'column',

    marginTop: 10,
  },

  nomeCompletoUser: {
    color: THEME.colors.branco,
    fontWeight: 'bold',
    fontSize: 16,
  },

  cargo: {
    color: THEME.colors.cinza,
  },

  statusOnline: {
    marginTop: .5,
    display: 'flex',
    flexDirection: 'row',
    padding: 2,
  },

  statusOnlineBolinhah: {
    borderRadius: 2.5,
    alignSelf: 'center',
    height: 5,
    width: 5,
  },

  bolinhaOnline: {
    backgroundColor: STATUS.colors.verde,
  },
  bolinhaOffline: {
    backgroundColor: STATUS.colors.vermelho,
  },

  textoStatus: {
    fontWeight: 'bold',
  },

  textoOnline: {
    color: STATUS.colors.verde,
  },
  textoOffline: {
    color: STATUS.colors.vermelho,
  },

  // Parte dos cards

  caixaCards: {
    marginTop: '23%',
    paddingBottom: 20,
    height: '70%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-around',
  },

  card: {
    backgroundColor: THEME.colors.roxoEscuro,
    borderRadius: THEME.border.bordaArredondada,
    padding: 16,
    elevation: 3, // Sombra Android
    shadowColor: '#000', // Sombra iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,

    width: '100%',

    boxShadow: THEME.shadow.sombra,

    borderRightWidth: 2,
    borderColor: THEME.colors.amareloSubtitulo,
    borderStyle: 'solid',
  },

  tituloCard: {
    fontSize: THEME.tamanhoTextos.tituloCard,
    color: THEME.colors.cinza,
  },

  produtoCard: {
    fontSize: THEME.tamanhoTextos.produtoCard,
    fontWeight: 'bold',
    color: THEME.colors.branco,
  },

  quantidadeProduto: {
    fontSize: THEME.tamanhoTextos.tituloQntProdutos,
    fontWeight: '600',
    color: THEME.colors.amareloSubtitulo,
    marginVertical: 4,
  },

  status: {
    alignSelf: 'flex-start',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },

  statusOk: {
    backgroundColor: STATUS.colors.verdeTransparente,
    borderWidth: 2,
    borderColor: STATUS.colors.verde,
    borderStyle: 'solid',
  },

  statusCritico: {
    backgroundColor: STATUS.colors.vermelhoTransparente,
    borderWidth: 2,
    borderColor: STATUS.colors.vermelho,
    borderStyle: 'solid',
  },

  // Sem produto válido (Nenhum / Aguardando): não é falta de estoque
  statusNeutro: {
    backgroundColor: STATUS.colors.cinzaTransparente,
    borderWidth: 2,
    borderColor: THEME.colors.cinza,
    borderStyle: 'solid',
  },

  statusTexto: {
    fontSize: THEME.tamanhoTextos.textoStatus,
    fontWeight: 'bold',
    color: THEME.colors.branco
  },
});