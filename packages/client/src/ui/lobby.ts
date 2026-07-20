import { getStateCallbacks } from "@colyseus/sdk";
import { PLAYER_COLORS, type MatchStartedMessage } from "@shattered-dominion/shared";
import { GameConnection } from "../net/connection.js";

interface PlayerLike {
  sessionId: string;
  name: string;
  colorIndex: number;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

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
      <div id="painel-entrada" class="painel">
        <div class="campo">
          <label for="nome">Seu nome</label>
          <input id="nome" maxlength="16" placeholder="Aventureiro" autocomplete="off" />
        </div>
        <div class="campo">
          <label>Sua cor</label>
          <div class="cores" id="cores">${PLAYER_COLORS.map(
            (c, i) =>
              `<button type="button" class="cor" data-cor="${i}" style="background:${hex(c)}"></button>`,
          ).join("")}</div>
        </div>
        <button id="btn-criar">Criar sala</button>
        <p class="divisor">ou entre numa sala</p>
        <div class="campo">
          <label for="codigo">Código da sala</label>
          <input id="codigo" maxlength="6" placeholder="ABC123" autocomplete="off" />
        </div>
        <button id="btn-entrar" class="secundario">Entrar</button>
        <p class="erro" id="erro-entrada"></p>
      </div>
      <div id="painel-sala" class="painel oculto">
        <div class="campo">
          <p class="dica">compartilhe o código com o grupo</p>
          <div class="codigo-sala" id="codigo-sala"></div>
        </div>
        <ul class="jogadores" id="lista-jogadores"></ul>
        <button id="btn-iniciar" class="oculto">Iniciar partida</button>
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

  // seletor de cor persistido
  let corEscolhida = Number(localStorage.getItem("sd:cor") ?? 0) % PLAYER_COLORS.length;
  const swatches = [...ui.querySelectorAll<HTMLButtonElement>(".cor")];
  const marcarCor = () => {
    swatches.forEach((b, i) => b.classList.toggle("ativa", i === corEscolhida));
  };
  swatches.forEach((b, i) =>
    b.addEventListener("click", () => {
      corEscolhida = i;
      localStorage.setItem("sd:cor", String(i));
      marcarCor();
    }),
  );
  marcarCor();

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
      void entrar(() => GameConnection.createRoom(nomeInput.value.trim(), corEscolhida));
    });
    btnEntrar.addEventListener("click", () => {
      if (codigoInput.value.trim().length !== 6) {
        erro.textContent = "O código tem 6 caracteres.";
        return;
      }
      void entrar(() =>
        GameConnection.joinByCode(codigoInput.value, nomeInput.value.trim(), corEscolhida),
      );
    });
    codigoInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") btnEntrar.click();
    });
  });

  function mostrarSala(conn: GameConnection): void {
    el<HTMLDivElement>("#painel-entrada").classList.add("oculto");
    el<HTMLDivElement>("#painel-sala").classList.remove("oculto");
    el<HTMLDivElement>("#codigo-sala").textContent = conn.roomCode;

    const lista = el<HTMLUListElement>("#lista-jogadores");
    const dica = el<HTMLParagraphElement>("#dica-sala");
    const jogadores = new Map<string, { nome: string; cor: number }>();
    let hostId = "";

    const render = () => {
      lista.innerHTML = "";
      for (const [id, { nome, cor }] of jogadores) {
        const li = document.createElement("li");
        const diamante = document.createElement("span");
        diamante.textContent = "◆ ";
        diamante.style.color = hex(PLAYER_COLORS[cor % PLAYER_COLORS.length]);
        li.appendChild(diamante);
        li.append(
          `${nome}${id === hostId ? " (host)" : ""}${id === conn.sessionId ? " — você" : ""}`,
        );
        lista.appendChild(li);
      }
      const souHost = hostId === conn.sessionId;
      btnIniciar.classList.toggle("oculto", !souHost);
      dica.textContent = souHost
        ? "você é o host — inicie quando todos chegarem"
        : "aguardando o host iniciar...";
    };

    const $ = getStateCallbacks(conn.room);
    const state = $(conn.room.state);
    state.players.onAdd((p: PlayerLike, id: string) => {
      jogadores.set(id, { nome: p.name, cor: p.colorIndex });
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
