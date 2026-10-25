import { UsersThreeIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { PlayerInfo, StatusSnapshot } from "@shared/types";

function PlayerAvatar({ player }: { player: PlayerInfo }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex size-8 items-center justify-center rounded-md bg-secondary text-xs font-semibold uppercase">
        {player.name.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={`https://mc-heads.net/avatar/${player.id}/32`}
      alt=""
      width={32}
      height={32}
      onError={() => setFailed(true)}
      className="size-8 rounded-md bg-secondary [image-rendering:pixelated]"
    />
  );
}

export function PlayerList({ status }: { status: StatusSnapshot | null }) {
  const ping = status?.ping ?? null;
  const players = ping?.players ?? [];
  const hidden = ping ? Math.max(0, ping.playersOnline - players.length) : 0;

  if (!ping) {
    return (
      <EmptyPlayers
        title="Server offline"
        text="Players show up here while the server is running and reachable."
      />
    );
  }
  if (ping.playersOnline === 0) {
    return <EmptyPlayers title="Nobody online" text={`0 of ${ping.playersMax} slots in use.`} />;
  }
  return (
    <ul className="divide-y" data-testid="player-list">
      {players.map((player) => (
        <li key={player.id} className="flex items-center gap-3 py-2.5" data-testid="player">
          <PlayerAvatar player={player} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{player.name}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{player.id}</p>
          </div>
        </li>
      ))}
      {hidden > 0 && (
        <li className="py-2.5 text-sm text-muted-foreground">
          +{hidden} more (the server only lists {players.length} names)
        </li>
      )}
    </ul>
  );
}

function EmptyPlayers({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-start gap-2 py-6">
      <span className="flex size-9 items-center justify-center rounded-lg border bg-secondary/50 text-muted-foreground">
        <UsersThreeIcon size={18} />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-[32ch] text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
