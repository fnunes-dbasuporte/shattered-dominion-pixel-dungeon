/**
 * Load test headless: sobe o servidor em-processo, conecta N clientes reais
 * (SDK, sem navegador) fazendo random-walk e mede a duração dos ticks.
 *
 * Uso: pnpm loadtest [-- --duration 300 --players 8 --mobs 20]
 * Sai com código 1 se o p95 dos ticks passar de 50ms.
 */
import { ColyseusTestServer } from "@colyseus/testing";
import { DIRECTIONS8, MessageType } from "@shattered-dominion/shared";
import { createGameServer } from "./app.js";
import type { GameRoom } from "./rooms/GameRoom.js";

const P95_BUDGET_MS = 50;
const LOADTEST_PORT = 2597;

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main(): Promise<void> {
  const durationS = flag("--duration", 60);
  const players = Math.min(8, flag("--players", 8));
  const targetMobs = flag("--mobs", 20);

  // boot() ignora a porta na sobrecarga de Server (fixa 2568 e colidiria com
  // o pnpm test) — sobe manualmente na porta própria do load test
  const gameServer = createGameServer();
  await gameServer.listen(LOADTEST_PORT);
  const colyseus = new ColyseusTestServer(gameServer);
  const host = await colyseus.sdk.create("game", { name: "load-1" });
  const clients = [host];
  for (let i = 2; i <= players; i++) {
    clients.push(await colyseus.sdk.joinById(host.roomId, { name: `load-${i}` }));
  }

  const room = colyseus.getRoomById(host.roomId) as GameRoom;
  host.send(MessageType.Start);
  await room.waitForMessage(MessageType.Start);

  const match = room.currentMatch;
  if (!match) throw new Error("partida não iniciou");
  if (match.mobCount < targetMobs) match.spawnRandomMobs(targetMobs - match.mobCount);
  console.log(
    `[loadtest] ${players} jogadores · ${match.mobCount} mobs · ${durationS}s · ` +
      `orçamento p95 < ${P95_BUDGET_MS}ms`,
  );

  // random-walk: cada cliente numa cadência própria (250–500ms)
  const walkers = clients.map((c) =>
    setInterval(
      () => {
        const d = DIRECTIONS8[Math.floor(Math.random() * DIRECTIONS8.length)];
        c.send(MessageType.Move, { dx: d.x, dy: d.y });
      },
      250 + Math.random() * 250,
    ),
  );

  const t0 = Date.now();
  const progress = setInterval(() => {
    const s = room.tickStats();
    console.log(
      `[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ` +
        `ticks=${s.count} média=${s.avg.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms ` +
        `máx=${s.max.toFixed(2)}ms`,
    );
  }, 15_000);

  await new Promise((r) => setTimeout(r, durationS * 1000));
  clearInterval(progress);
  walkers.forEach(clearInterval);

  const s = room.tickStats();
  console.log("\n===== resultado =====");
  console.log(`ticks executados: ${s.count}`);
  console.log(`duração média:    ${s.avg.toFixed(2)}ms`);
  console.log(`p95:              ${s.p95.toFixed(2)}ms`);
  console.log(`máxima:           ${s.max.toFixed(2)}ms`);
  const ok = s.p95 < P95_BUDGET_MS;
  console.log(
    ok ? `OK — p95 dentro do orçamento de ${P95_BUDGET_MS}ms` : `FALHOU — p95 ≥ ${P95_BUDGET_MS}ms`,
  );

  await Promise.all(clients.map((c) => c.leave()));
  await colyseus.shutdown();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[loadtest] erro:", err);
  process.exit(1);
});
