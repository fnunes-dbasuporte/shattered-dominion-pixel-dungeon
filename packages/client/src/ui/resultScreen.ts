import { PLAYER_COLORS, type RunEndedMessage } from "@shattered-dominion/shared";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** duração em ticks (10/s) → "mm:ss". */
function formatDuration(ticks: number): string {
  const total = Math.floor(ticks / 10);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Tela de resultado da run (DOM sobre o canvas, estilo do inventário).
 * Mostra vitória/derrota, duração e a tabela de estatísticas por jogador;
 * o botão único devolve todos ao lobby.
 */
export function showResultScreen(msg: RunEndedMessage, onBackToLobby: () => void): void {
  document.getElementById("result")?.remove();

  const root = document.createElement("div");
  root.id = "result";

  const titulo = msg.victory ? "VITÓRIA!" : "DERROTA";
  const subtitulo = msg.victory
    ? "O Amuleto do Domínio foi conquistado — o esgoto tem novos donos."
    : "O esgoto venceu. O Amálgama segue no covil…";

  let linhas = "";
  for (const p of msg.stats) {
    const cor = `#${PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length]
      .toString(16)
      .padStart(6, "0")}`;
    linhas += `<tr>
      <td style="color:${cor}">${escapeHtml(p.name)}</td>
      <td>${p.level}</td>
      <td>${p.kills}</td>
      <td>${p.deaths}</td>
      <td>${p.gold}</td>
    </tr>`;
  }

  root.innerHTML = `<div class="result-card">
    <h1 class="result-title ${msg.victory ? "vitoria" : "derrota"}">${titulo}</h1>
    <p class="result-sub">${subtitulo}</p>
    <p class="result-sub">duração da run: ${formatDuration(msg.durationTicks)}</p>
    <table class="result-table">
      <thead><tr><th>jogador</th><th>nível</th><th>abates</th><th>mortes</th><th>ouro</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <button class="result-btn" type="button">Voltar ao lobby</button>
  </div>`;

  root.querySelector<HTMLButtonElement>(".result-btn")!.addEventListener("click", onBackToLobby);
  document.body.appendChild(root);
}
