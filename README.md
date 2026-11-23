# Sudo Sequencer

A generative house, techno and trance machine that runs in the browser, with a 3D club and an
avatar DJ on the decks.

Press START and it composes a track while you listen. It picks a band of drum and synth sounds,
then a genetic search writes each part bar by bar (kick, clap, hats, percussion, bass, chords, pad,
arp, lead) against hand-written musical rules. The result is a 72-bar arrangement: intro, groove,
drop, breakdown, build, second drop, outro. Everything is synthesised live with Web Audio. While it
plays, the club answers the music: moving heads, lasers, haze, an LED wall that shows the sequencer,
a crowd, and a dancer who stays on the beat.

Tell the **DJ** what you want in plain words ("dark warehouse techno at 135", "faster", "warmer, with
piano chords") and the next song is set up for it.

## Features

- **Generative tracks**: 14 styles across house, techno and trance, in any key and six modes,
  with 70+ synthesised instruments. Watch a track being searched part by part, or skip to the
  finished arrangement.
- **Sets**: each song plays for a number of rounds (3 by default), then hands over to the next one
  on the downbeat.
- **The DJ chat**: powered by Jev (`typesafe/jev-1.13`), a structured decision model on
  OpenRouter. It answers typed questions about your request (style, mood, tempo, groove, key, the
  sound of each part) with calibrated confidence, and only confident answers change the music.
- **A 3D club**: camera direction, light patterns and a VRM avatar that dances to the arrangement.
  Characters: SUDO (default), Optimus Prime, Victoria, Aurora, Orion, Frosty.
- **Play along**: an optional rhythm game on six keys. Notes fall in time with the track's own
  melody, combos raise a multiplier and light up the club.
- **Keep what you make**: save loops in the browser, share them as links, export MIDI, or record
  the set to a WAV.
- Works on desktop and on phones, in portrait and landscape.

## Run it locally

Needs **Node.js 20.12+** and npm.

```bash
git clone https://github.com/TheHuntaP3/sudo-sequencer.git
cd sudo-sequencer
npm install
./scripts/fetch-assets.sh     # the free avatars and dance clips that are not in the repo
```

Create a `.env` file in the project root (git ignores it):

```
OPENROUTER_API_KEY=sk-or-...
JEV_MODEL=typesafe/jev-1.13
PORT=4173
```

| Variable | Needed | What it does |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | for the DJ chat | Your [OpenRouter](https://openrouter.ai) key. Without it everything works except the DJ, who says he is offline. |
| `JEV_MODEL` | no | The decision model; defaults to `typesafe/jev-1.13`. |
| `PORT` | no | Defaults to 4173. |
| `PUBLIC_URL` | no | The site's address for `robots.txt` and `sitemap.xml`; defaults to `https://sequencer.sudo.la`. |
| `TRUST_PROXY` | behind a proxy | Set to `1` (or the number of proxies) so the DJ's rate limit sees real visitors. |

Then start it:

```bash
npm start                     # http://localhost:4173/
```

Browsers only allow audio after a click, so press **START** first.

For a production build, run `npm run build` before `npm start`. It writes minified files with a
content hash in their names to `dist/` (esbuild, about a second), and the server then serves those:
the hashed files are cached for a year and `index.html` never is, so every deploy loads the new code
at once. Without a build the server serves the source files directly, which is handy while editing.

`npm test` runs the server tests.

## Controls

| Key | Does |
| --- | --- |
| `Space` | Start / pause |
| `N` | Next song (lands on the next downbeat) |
| `B` | Skip the build and play the finished track |
| `R` | Record the set; press again to save a WAV |
| `G` | Show or hide the play-along game |
| `S D F J K L` | The six game keys |
| `/` | Type to the DJ (`Escape` leaves the box) |
| `Tab` | Setup: style, sounds, rounds per song, loops, character, MIDI/WAV |

On a phone the top-right actions are in the **MENU**, and the game keys can be tapped.

## How it works

- **The engine** (`js/genome.js`, `js/club.js`) is pure logic plus a Web Audio scheduler. A seed
  picks the style, key, tempo and sounds; a genetic search evolves each part's pattern against
  rules for groove, syncopation and harmony; the arrangement turns parts on and off by section.
- **The stage** (`js/stage.js`, `js/fx.js`, `js/vrm.js`, three.js) listens to the audio clock.
  Each part drives part of the light rig, a camera director cuts between shots on section changes,
  and the avatar dances whole motion-capture loops (and their mirror images), stretched to whole
  bars and changed only on downbeats.
- **The DJ** (`server/jev.js`) runs on the server, which holds the OpenRouter key. For each
  message it sends Jev one request with about twenty typed questions, built from the engine's own
  catalog of styles and sounds. Yes/no screens ("does the request mention a tempo?") gate the
  detailed answers, numbers like "135 bpm" are read by code, the reply is written from what was
  decided, and everything is validated before it reaches the browser. The endpoint is rate-limited.
- **The game** (`js/rhythm.js`) charts the next bars of the arrangement and judges presses against
  the audio clock (PERFECT ±70 ms, GREAT ±130 ms, GOOD ±200 ms).

## Project layout

```
index.html            the page: stage canvas, HUD, setup drawer
css/app.css           the HUD, including the phone layouts
js/genome.js          instruments, styles, the genetic search, the arrangement (no DOM, no audio)
js/club.js            the synth, the scheduler, the set, MIDI and WAV export
js/stage.js           the 3D club: room, lights, lasers, crowd, camera director
js/vrm.js             the DJ avatar: loading, dances, emotes, face
js/fx.js              post-processing, haze beams, the crowd
js/game.js            the HUD: top bar, meters, beat rail, menu, setup drawer, shortcuts
js/rhythm.js          the play-along game
js/jev.js             the DJ chat box
js/loops.js           saved loops, share links, import/export
js/midi.js, timer.js, download.js   MIDI/zip writing, a background-safe ticker, file saving
js/vendor/            three.js, its loaders and post-processing, three-vrm
server/index.js       Express: serves the app and /api/jev
server/jev.js         the DJ: questions, confidence rules, replies, validation
scripts/build.mjs     the production build (esbuild)
scripts/fetch-assets.sh  downloads the free avatars and dance clips
assets/vrm, assets/vrma  avatars and motion clips
tests/                node --test suites
```

## Deploy

The repository includes a `Dockerfile` (Alpine) and a `docker-compose.yml` ready for
[Coolify](https://coolify.io) or any Docker host. The image fetches the free assets, builds the
frontend, and runs the server as a non-root user on a read-only filesystem, with a health check.

**Coolify**: New resource → Docker Compose → this repository. Set `OPENROUTER_API_KEY` under
Environment Variables (`TRUST_PROXY` defaults to `1` for Coolify's proxy; use `2` with Cloudflare
in front), give the service a domain with port 4173 (`https://your.domain:4173`), and deploy.

**Elsewhere**: `OPENROUTER_API_KEY=... docker compose up -d --build`, and add a `ports:` entry
(`"4173:4173"`) if no proxy sits in front.

## Credits

- Avatars: **SUDO** is "Reality(CT-DJ)" by BlueBlurChamp; **Optimus Prime** is "G1コンボイ" by
  shionpime; **Victoria** (CC0) from tunguyen1993/ani-3d-companion; **Aurora, Orion and Frosty**
  (CC0) from ToxSam's 100Avatars. The setup drawer credits the avatar on stage.
- Motion clips: tunguyen1993/ani-3d-companion and tk256ailab/vrm-viewer (MIT).
- [three.js](https://threejs.org) and [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) (MIT).
- The DJ runs on [Jev](https://docs.typesafe.ai) by TypeSafe, via OpenRouter.
