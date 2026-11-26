// Volcano Sky Courier — entry program (Node 22, standard library only).
// Hands the game in: copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json, the summary the judge reads,
// with the vendored make.fun library. Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Both runs must write the same bytes; this program writes nothing that
// depends on time, randomness or the environment.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's caps for this bounty: at most 4 screenshots, each at most
// 256 KiB; game/ at most 993 files and 48 MiB in all; dossier text at most
// 163840 bytes. buildDossier enforces them and refuses anything over.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
