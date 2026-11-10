# Majlis — watch together

Watch the same video at the same moment with friends anywhere, and talk with voice or video while you watch.

## What it does
- **Rooms with an invite link.** Start a room, press *Copy invite link*, send it on WhatsApp. Friends tap it, type a name and join. Up to 8 people per room.
- **Everyone has the remote.** Anyone can press **Play/Pause**, **⟲ 10s** or **10s ⟳** (or use the player's own controls), and it happens for everyone. People who join late land at the right moment. *Sync everyone to me* fixes any drift.
- **Talk during the movie.** Voices come through separately from the movie, so you can talk the whole time it plays. Turn on **Lower movie when friends talk** and the movie gets quieter while someone speaks, then comes back up.
- **Built for long nights.** If someone's internet drops, their phone sleeps, they refresh the page, or the server restarts, Majlis reconnects the call and the video by itself. The screen stays awake while the movie plays, and the free host is kept awake while you're in a room.
- **What you can watch:**
  - YouTube links (normal videos, Shorts, live)
  - Direct video links ending in `.mp4` or `.webm`
  - A video file on your device: everyone picks their own copy of the same file
  - Anything else (another app or website): use **Share screen** from a computer
- **Calls:** microphone with **Mute/Unmute**, **Start/Stop video**, **Speaker on/off** (mutes everyone you hear), a volume slider on each person, and a green ring around whoever is talking.
- **Chat and reactions** (😂 ❤️ 😮 👏).
- Works in Chrome, Edge, Safari and Firefox on phones and computers. Screen sharing needs a computer browser.

## Put it online for free (Render.com, about 10 minutes)
Mic and camera only work on an `https://` address, so it must be hosted. Render gives you one free.

1. Create a free account at **github.com**. Make a new repository called `majlis` and upload the files from this folder (`server.js`, `package.json`, `README.md` and the `public` folder).
2. Create a free account at **render.com** and sign in with GitHub.
3. Click **New → Web Service** and pick the `majlis` repository.
4. Fill in: Runtime **Node**, Build command **`npm install`**, Start command **`node server.js`**, Instance type **Free**.
5. Click **Create Web Service**. After a few minutes you get a link like `https://majlis-xxxx.onrender.com`. That's your site.

Free plan note: the site sleeps after 15 minutes with nobody on it. The first visit after that takes about 50 seconds to wake up, then it is fast.

## If a friend can't hear or see the others
Most home and mobile networks connect directly. A few strict networks (some offices, some mobile carriers) need a relay called a TURN server. You can get a free one (for example from metered.ca, which has a free monthly allowance), then add these in Render → your service → **Environment**:

- `TURN_URL` — e.g. `turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443?transport=tcp`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

Video sync and chat always work, even when the call can't connect.

## Good to know
- Netflix, Shahid, Disney+ and similar apps block screen sharing of their videos (you'll see a black screen). For those, each person can play it in their own app and use the call and chat here.
- Calls connect each person directly to every other person, so it works best with up to 6–8 people.
- **Use headphones** (earbuds are fine). Without them, your mic picks up the movie from your speakers and friends hear it twice. On iPhone, headphones also keep the movie at full volume while the mic is on.
- Keep the Majlis tab open and in front. Phones pause the mic when you switch to another app.
- Room data is kept in memory only. Nothing is stored after everyone leaves.

## Run it on your own computer
Install Node.js 18 or newer, then in this folder run:

```
node server.js
```

Open http://localhost:3000. There are no packages to install.

Optional settings: `PORT` (default 3000), `MAX_PEERS` (default 8).
