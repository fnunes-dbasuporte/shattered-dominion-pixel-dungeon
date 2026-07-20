/**
 * Smoke test end-to-end contra um servidor JÁ PUBLICADO — sem navegador.
 *
 * Sobe 2 clientes reais com o mesmo `@colyseus/sdk` do jogo, pelo wss público,
 * e joga de verdade: cria sala, entra por código, mede latência, inicia a
 * partida, anda, conversa, cai e reconecta pelo token, e desce de andar por
 * voto. Sai com código 1 se qualquer verificação falhar.
 *
 * Uso: pnpm smoke:prod [-- --endpoint URL --walk 20]
 *
 * Roda contra produção por padrão. Cria uma sala real (efêmera, descartada no
 * fim) e NÃO reinicia nada — pode rodar com gente jogando. Faz parte das
 * verificações de deploy (docs/DEPLOY.md §4).
 */
import { parseArgs } from "node:util";
import { Client, type Room } from "@colyseus/sdk";
import {
  DIRECTIONS8,
  Grid,
  MessageType,
  canStep,
  type ChatBroadcast,
  type MatchStartedMessage,
  type Vec2,
  type VisionMessage,
} from "../../packages/shared/src/index.js";

const ENDPOINT_PADRAO = "https://www.pixelforgegames.com.br/shattered-dominion-ws";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Corrida contra o relógio: nenhuma espera do teste pode pendurar a execução. */
function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  return Promise.race([
    p,
    sleep(ms).then<never>(() => Promise.reject(new Error(`timeout: ${oque} (${ms}ms)`))),
  ]);
}

// ── relatório ───────────────────────────────────────────────────────
interface Verificacao {
  nome: string;
  ok: boolean;
  detalhe: string;
}
const resultados: Verificacao[] = [];

function check(nome: string, ok: boolean, detalhe = ""): void {
  resultados.push({ nome, ok, detalhe });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFALHA\x1b[0m";
  console.log(`  [${tag}] ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}
const etapa = (t: string): void => console.log(`\n\x1b[1;36m== ${t}\x1b[0m`);
const info = (t: string): void => console.log(`  [info] ${t}`);

// ── bot: um cliente com memória do que o servidor mandou ─────────────
interface Waiter {
  type: string;
  predicate: (msg: unknown) => boolean;
  resolve: (msg: unknown) => void;
}

interface Bot {
  nome: string;
  room?: Room;
  visoes: number;
  ultimaVisao?: VisionMessage;
  /** memória do mapa: índice do tile → TileType (o servidor só manda novidade) */
  descobertos: Map<number, number>;
  grid?: Grid;
  eventos: VisionMessage["events"];
  waiters: Waiter[];
}

const novoBot = (nome: string): Bot => ({
  nome,
  visoes: 0,
  descobertos: new Map(),
  eventos: [],
  waiters: [],
});

/**
 * Espera uma mensagem que AINDA VAI chegar. Só serve para o que o teste provoca
 * (pong, matchStarted, chat, floorChanged) — nunca para a visão, que pode já
 * ter chegado antes de registrarmos o interesse.
 */
function esperaMensagem<T>(bot: Bot, type: string, ms = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      bot.waiters = bot.waiters.filter((w) => w !== waiter);
      reject(new Error(`timeout esperando "${type}" (${ms}ms)`));
    }, ms);
    const waiter: Waiter = {
      type,
      predicate: () => true,
      resolve: (msg) => {
        clearTimeout(t);
        resolve(msg as T);
      },
    };
    bot.waiters.push(waiter);
  });
}

/**
 * Espera a PRIMEIRA visão por sondagem. A visão só é enviada quando MUDA
 * (Match.collectVisions compara com lastVisionKey), então com todo mundo parado
 * não vem mensagem nenhuma — esperar por uma futura penduraria o teste.
 */
async function esperaPrimeiraVisao(bot: Bot, ms = 10_000): Promise<VisionMessage> {
  const limite = Date.now() + ms;
  while (!bot.ultimaVisao) {
    if (Date.now() > limite) throw new Error(`timeout: primeira visão de ${bot.nome} (${ms}ms)`);
    await sleep(50);
  }
  return bot.ultimaVisao;
}

/** Espelha no grid tudo o que já foi descoberto — o mapa nunca perde nada. */
function sincronizaGrid(bot: Bot): Grid | undefined {
  if (!bot.grid) return undefined;
  for (const [i, t] of bot.descobertos) bot.grid.tiles[i] = t;
  return bot.grid;
}

/** Liga o bot à sala. O SDK descarta mensagem sem handler — registrar já. */
function conecta(bot: Bot, room: Room): Bot {
  bot.room = room;
  const entrega = (type: string, msg: unknown): void => {
    for (const w of [...bot.waiters]) {
      if (w.type === type && w.predicate(msg)) {
        bot.waiters = bot.waiters.filter((x) => x !== w);
        w.resolve(msg);
      }
    }
  };

  room.onMessage(MessageType.Vision, (msg: VisionMessage) => {
    bot.visoes++;
    bot.ultimaVisao = msg;
    for (const [i, t] of msg.discovered) bot.descobertos.set(i, t);
    bot.eventos.push(...msg.events);
    entrega(MessageType.Vision, msg);
  });
  for (const type of [
    MessageType.MatchStarted,
    MessageType.FloorChanged,
    MessageType.Chat,
    MessageType.Pong,
    MessageType.RunEnded,
  ]) {
    room.onMessage(type, (msg: unknown) => entrega(type, msg));
  }
  room.onError((code, message) => console.log(`  [erro ${bot.nome}] ${code} ${message ?? ""}`));
  return bot;
}

/** Um passo válido a partir do mapa que o bot conhece (sem atravessar parede). */
function passoValido(bot: Bot): Vec2 | undefined {
  const grid = sincronizaGrid(bot);
  if (!grid || !bot.ultimaVisao) return undefined;
  const de: Vec2 = { x: bot.ultimaVisao.you.x, y: bot.ultimaVisao.you.y };
  const opcoes = DIRECTIONS8.filter((d) => canStep(grid, de, d));
  return opcoes.length ? opcoes[Math.floor(Math.random() * opcoes.length)] : undefined;
}

// ── execução ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { endpoint: { type: "string" }, walk: { type: "string" } },
  });
  const endpoint = values.endpoint ?? ENDPOINT_PADRAO;
  const segundosAndando = Number(values.walk ?? 20);

  console.log(`\nSmoke test de produção — ${endpoint}`);
  const t0 = Date.now();
  const A = novoBot("smoke-A");
  const B = novoBot("smoke-B");
  let codigo = "?";

  try {
    etapa("1. Conexão e lobby");
    const clienteA = new Client(endpoint);
    const clienteB = new Client(endpoint);

    const salaA = await comPrazo(
      clienteA.create("game", { name: A.nome, color: 0 }),
      15_000,
      "create",
    );
    conecta(A, salaA);
    codigo = salaA.roomId;
    check(
      "cliente A cria sala pelo wss público",
      /^[A-HJ-NP-Z2-9]{6}$/.test(codigo),
      `código ${codigo}`,
    );

    const salaB = await comPrazo(
      clienteB.joinById(codigo, { name: B.nome, color: 3 }),
      15_000,
      "joinById",
    );
    conecta(B, salaB);
    check("cliente B entra pelo código de 6 letras", salaB.roomId === codigo);

    await sleep(600);
    const estado = salaA.state as { players: { size: number }; phase: string };
    check(
      "schema do lobby lista os 2 jogadores",
      estado.players.size === 2,
      `phase=${estado.phase}`,
    );

    etapa("2. Latência (ping/pong pelo proxy)");
    const rtts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const enviado = Date.now();
      const pong = esperaMensagem(A, MessageType.Pong, 5_000);
      salaA.send(MessageType.Ping, { t: enviado });
      await pong;
      rtts.push(Date.now() - enviado);
      await sleep(200);
    }
    const media = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length);
    check(
      "pong responde ao ping",
      rtts.length === 5,
      `RTT ${Math.min(...rtts)}–${Math.max(...rtts)}ms (média ${media}ms)`,
    );

    etapa("3. Início da partida");
    const iniciouA = esperaMensagem<MatchStartedMessage>(A, MessageType.MatchStarted);
    const iniciouB = esperaMensagem<MatchStartedMessage>(B, MessageType.MatchStarted);
    salaA.send(MessageType.Start);
    const [msA, msB] = await Promise.all([iniciouA, iniciouB]);
    A.grid = new Grid(msA.width, msA.height);
    B.grid = new Grid(msB.width, msB.height);
    check(
      "host inicia e ambos recebem matchStarted",
      msA.depth === 1 && msB.depth === 1,
      `mapa ${msA.width}×${msA.height}, andar ${msA.depth}`,
    );

    etapa(`4. Movimento e visão por ${segundosAndando}s`);
    const [primeiraA] = await Promise.all([esperaPrimeiraVisao(A), esperaPrimeiraVisao(B)]);
    const inicio = Date.now();
    const visoesNoInicio = A.visoes;
    const nascimento: Vec2 = { x: primeiraA.you.x, y: primeiraA.you.y };
    const andarilhos = [A, B].map((bot) =>
      setInterval(() => {
        const d = passoValido(bot);
        if (d) bot.room?.send(MessageType.Move, { dx: d.x, dy: d.y });
      }, 350),
    );
    await sleep(segundosAndando * 1000);
    andarilhos.forEach(clearInterval);

    const decorrido = (Date.now() - inicio) / 1000;
    const ultimaA = A.ultimaVisao!;
    // A simulação roda a 10 ticks/s; a VISÃO só viaja quando muda. O que se
    // mede aqui é o avanço do campo `tick`, não a quantidade de mensagens.
    const ticks = ultimaA.tick - primeiraA.tick;
    const taxa = ticks / decorrido;
    check(
      "simulação roda a ~10 ticks/s",
      taxa > 9 && taxa < 11,
      `${ticks} ticks em ${decorrido.toFixed(1)}s = ${taxa.toFixed(1)}/s`,
    );
    check(
      "visão enviada só quando muda (economia de banda)",
      A.visoes - visoesNoInicio > 0 && A.visoes - visoesNoInicio < ticks,
      `${A.visoes - visoesNoInicio} mensagens para ${ticks} ticks`,
    );
    check(
      "jogador andou e o mapa foi descoberto",
      (ultimaA.you.x !== nascimento.x || ultimaA.you.y !== nascimento.y) && A.descobertos.size > 0,
      `A em (${ultimaA.you.x},${ultimaA.you.y}) hp ${ultimaA.you.hp}/${ultimaA.you.maxHp} · ` +
        `${A.descobertos.size} tiles descobertos · nível ${ultimaA.you.level}`,
    );
    check(
      "A enxerga outros atores (FOV)",
      ultimaA.actors.length >= 1,
      `${ultimaA.actors.length} no FOV`,
    );
    const tipos = [...new Set(A.eventos.map((e) => e.type))];
    info(
      A.eventos.length
        ? `${A.eventos.length} eventos: ${tipos.join(", ")}`
        : "nenhum mob no caminho",
    );

    etapa("5. Chat");
    const recebeu = esperaMensagem<ChatBroadcast>(B, MessageType.Chat, 5_000);
    salaA.send(MessageType.Chat, { text: "smoke: teste de produção" });
    const chat = await recebeu;
    check("B recebe o chat de A", chat.name === A.nome, `"${chat.text}"`);

    etapa("6. Queda e reconexão por token (o caminho do F5)");
    const token = salaB.reconnectionToken;
    // Deixa a fila de ações drenar: o último `move` enviado fica em `intent` no
    // servidor e só resolve quando a energia do ator vence (1 unidade = 1s).
    // Sem esta pausa, o herói ainda anda um tile DEPOIS da queda.
    await sleep(1500);
    const antes = { x: B.ultimaVisao!.you.x, y: B.ultimaVisao!.you.y, hp: B.ultimaVisao!.you.hp };
    // O SDK 0.17 religa sozinho a MESMA sala quando o socket cai — é o caminho
    // de queda de rede. Aqui queremos o outro: aba nova, Client novo e
    // reconnect(token) do sessionStorage. Desligar a religação automática é o
    // que torna a queda uma queda de verdade.
    salaB.reconnection.enabled = false;
    await salaB.leave(false);
    await sleep(1500);

    const B2 = novoBot(B.nome);
    const clienteAbaNova = new Client(endpoint);
    const salaB2 = await comPrazo(clienteAbaNova.reconnect(token), 15_000, "reconnect(token)");
    conecta(B2, salaB2);
    const msB2 = await esperaMensagem<MatchStartedMessage>(B2, MessageType.MatchStarted);
    B2.grid = new Grid(msB2.width, msB2.height);
    const vB2 = await esperaPrimeiraVisao(B2);
    // Tolerância de 1 tile de propósito: a simulação NÃO para enquanto o
    // jogador está fora. O que precisa ser idêntico é o herói (vida, sala),
    // não a coordenada — exigir o tile exato seria testar o relógio, não o jogo.
    const desvio = Math.max(Math.abs(vB2.you.x - antes.x), Math.abs(vB2.you.y - antes.y));
    check(
      "reconexão retoma o MESMO herói",
      vB2.you.hp === antes.hp && desvio <= 1,
      `antes (${antes.x},${antes.y}) hp ${antes.hp} → depois (${vB2.you.x},${vB2.you.y}) hp ${vB2.you.hp}` +
        (desvio ? ` · ${desvio} tile de desvio` : ""),
    );
    check("sala preservada na reconexão", salaB2.roomId === codigo, `sala ${salaB2.roomId}`);

    etapa("7. Descida de andar por voto");
    const desceu = esperaMensagem<MatchStartedMessage>(A, MessageType.FloorChanged, 15_000);
    salaA.send(MessageType.Stairs);
    await sleep(800);
    const votos = A.ultimaVisao!.descent;
    check("voto de A é contabilizado", votos?.votes === 1, `${votos?.votes}/${votos?.needed}`);
    salaB2.send(MessageType.Stairs);
    const novoAndar = await desceu;
    check("grupo desce para o andar 2", novoAndar.depth === 2, `andar ${novoAndar.depth}`);
    await sleep(1000);
    check(
      "visão pós-descida coerente",
      A.ultimaVisao!.depth === 2,
      `A no andar ${A.ultimaVisao!.depth} em (${A.ultimaVisao!.you.x},${A.ultimaVisao!.you.y})`,
    );

    etapa("8. Saída limpa");
    await salaA.leave(true);
    await salaB2.leave(true);
    check("clientes saíram sem erro", true);
  } catch (err) {
    check("execução sem exceção", false, err instanceof Error ? err.message : String(err));
  } finally {
    const falhas = resultados.filter((r) => !r.ok);
    console.log(
      `\n\x1b[1m${resultados.length - falhas.length}/${resultados.length} verificações OK\x1b[0m ` +
        `em ${((Date.now() - t0) / 1000).toFixed(1)}s (sala ${codigo})`,
    );
    process.exit(falhas.length ? 1 : 0);
  }
}

void main();
