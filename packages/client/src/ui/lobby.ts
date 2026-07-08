import { getStateCallbacks } from "@colyseus/sdk";
import type { MatchStartedMessage } from "@shattered-dominion/shared";
import { GameConnection } from "../net/connection.js";

interface PlayerLike {
  sessionId: string;
  name: string;
}

export interface LobbyResult {
  conn: GameConnection;
  started: MatchStartedMessage;
}

/**
 * Lobby em DOM simples sobre o canvas (decisão documentada: formulários e
 * listas são triviais em HTML e dispensam assets de UI nesta fase).
 * Resolve quando o servidor anuncia o início da partida.
 */
export function runLobby(): Promise<LobbyResult> {
  const ui = document.querySelector<HTMLDivElement>("#ui");
  if (!ui) throw new Error("#ui não encontrado");

  ui.innerHTML = `
    <div class="card">
      <h1>SHATTERED DOMINION<small>roguelike cooperativo até 8 jogadores</small></h1>
      <div id="painel-entrada">
        <label for="nome">Seu nome</label>
        <input id="nome" maxlength="16" placeholder="Aventureiro" autocomplete="off" />
        <button id="btn-criar">Criar sala</button>
        <p class="divisor">— ou entre numa sala —</p>
        <label for="codigo">Código da sala</label>
        <input id="codigo" maxlength="6" placeholder="ABC123" autocomplete="off" />
        <button id="btn-entrar" class="secundario">Entrar</button>
        <p class="erro" id="erro-entrada"></p>
      </div>
      <div id="painel-sala" style="display:none">
        <p class="dica">compartilhe o código com o grupo</p>
        <div class="codigo-sala" id="codigo-sala"></div>
        <ul class="jogadores" id="lista-jogadores"></ul>
        <button id="btn-iniciar" style="display:none">Iniciar partida</button>
        <p class="dica" id="dica-sala"></p>
      </div>
    </div>`;

  const el = <T extends HTMLElement>(sel: string) => ui.querySelector<T>(sel) as T;
  const nomeInput = el<HTMLInputElement>("#nome");
  const codigoInput = el<HTMLInputElement>("#codigo");
  const btnCriar = el<HTMLButtonElement>("#btn-criar");
  const btnEntrar = el<HTMLButtonElement>("#btn-entrar");
  const btnIniciar = el<HTMLButtonElement>("#btn-iniciar");
  const erro = el<HTMLParagraphElement>("#erro-entrada");

  nomeInput.value = localStorage.getItem("sd:nome") ?? "";

  return new Promise<LobbyResult>((resolve) => {
    const entrar = async (fazerConexao: () => Promise<GameConnection>) => {
      erro.textContent = "";
      btnCriar.disabled = btnEntrar.disabled = true;
      try {
        const conn = await fazerConexao();
        localStorage.setItem("sd:nome", nomeInput.value.trim());
        mostrarSala(conn);
        const started = await conn.waitForStart();
        ui.classList.add("hidden");
        ui.innerHTML = "";
        resolve({ conn, started });
      } catch (e) {
        erro.textContent = `Não foi possível entrar: ${e instanceof Error ? e.message : e}`;
        btnCriar.disabled = btnEntrar.disabled = false;
      }
    };

    btnCriar.addEventListener("click", () => {
      void entrar(() => GameConnection.createRoom(nomeInput.value.trim()));
    });
    btnEntrar.addEventListener("click", () => {
      if (codigoInput.value.trim().length !== 6) {
        erro.textContent = "O código tem 6 caracteres.";
        return;
      }
      void entrar(() => GameConnection.joinByCode(codigoInput.value, nomeInput.value.trim()));
    });
    codigoInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") btnEntrar.click();
    });
  });

  function mostrarSala(conn: GameConnection): void {
    el<HTMLDivElement>("#painel-entrada").style.display = "none";
    el<HTMLDivElement>("#painel-sala").style.display = "block";
    el<HTMLDivElement>("#codigo-sala").textContent = conn.roomCode;

    const lista = el<HTMLUListElement>("#lista-jogadores");
    const dica = el<HTMLParagraphElement>("#dica-sala");
    const jogadores = new Map<string, string>();
    let hostId = "";

    const render = () => {
      lista.innerHTML = "";
      for (const [id, nome] of jogadores) {
        const li = document.createElement("li");
        li.textContent = `${nome}${id === hostId ? " (host)" : ""}${id === conn.sessionId ? " — você" : ""}`;
        lista.appendChild(li);
      }
      const souHost = hostId === conn.sessionId;
      btnIniciar.style.display = souHost ? "block" : "none";
      dica.textContent = souHost
        ? "você é o host — inicie quando todos chegarem"
        : "aguardando o host iniciar...";
    };

    const $ = getStateCallbacks(conn.room);
    const state = $(conn.room.state);
    state.players.onAdd((p: PlayerLike, id: string) => {
      jogadores.set(id, p.name);
      render();
    });
    state.players.onRemove((_p: PlayerLike, id: string) => {
      jogadores.delete(id);
      render();
    });
    state.listen("hostSessionId", (v: string) => {
      hostId = v;
      render();
    });

    btnIniciar.addEventListener("click", () => {
      btnIniciar.disabled = true;
      conn.sendStart();
    });
  }
}
