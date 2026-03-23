# Wild Tuna Mode — Module Dependency Diagram

```mermaid
graph TD
    subgraph Entry["Entry Point"]
        main["main.ts"]
    end

    subgraph Core["Core Mode"]
        wt["modes/wild-tuna.ts"]
        types["modes/types.ts"]
    end

    subgraph UI["UI Modules"]
        jamflow["ui/jam-flow.ts"]
        looper["ui/ui-composite-looper.ts"]
        drum["ui/drum-machine.ts"]
        carousel["ui/carousel.ts"]
        swipe["ui/swipe-gesture.ts"]
        seigbg["ui/seigaihaBackground.ts"]
        loopable["ui/looper-recordable.ts"]
    end

    subgraph Audio["Audio Modules"]
        guitar["audio/circle-guitar-player.ts"]
        fret_sample["audio/fretboard-sample.ts"]
        embedded["audio/embedded-samples.ts"]
        woodblock["audio/woodblock-samples.ts"]
    end

    subgraph App["App Services"]
        share["app/share-payloads.ts"]
        noteevents["app/note-events.ts"]
        transport["app/session-transport.ts"]
        carousel_bridge["app/carousel-bridge.ts"]
        seig_bridge["app/seigaiha-bridge.ts"]
        bitbuf["app/bit-buffer.ts"]
    end

    subgraph Logic["Core Logic"]
        fretlogic["fretboard-logic.ts"]
        utils["utils.ts"]
    end

    %% main.ts wires everything together
    main --> wt
    main --> carousel
    main --> swipe
    main --> carousel_bridge

    %% wild-tuna.ts core dependencies
    wt --> guitar
    wt --> fret_sample
    wt --> jamflow
    wt --> drum
    wt --> looper
    wt --> noteevents
    wt --> transport
    wt --> carousel_bridge
    wt --> seig_bridge
    wt --> share
    wt --> fretlogic
    wt --> utils
    wt --> types

    %% UI internal deps
    drum --> embedded
    drum --> woodblock
    drum --> share
    looper --> loopable
    looper --> utils
    carousel --> types
    swipe --> types
    seig_bridge --> seigbg

    %% App service deps
    share --> fretlogic
    share --> looper
    share --> bitbuf
```

## Module Roles

| Module | Role |
|--------|------|
| `modes/wild-tuna.ts` | **Core orchestrator** — wires all subsystems together |
| `ui/jam-flow.ts` | Canvas UI: Circle of Fifths, Key Zoom, and Fretboard views |
| `ui/drum-machine.ts` | Drum transport UI, timing, BPM control |
| `ui/ui-composite-looper.ts` | Reusable looper widget (used for circle & fretboard loopers) |
| `audio/circle-guitar-player.ts` | Chord playback (acoustic, electric, organ instruments) |
| `audio/fretboard-sample.ts` | Fretboard instrument sample loading |
| `app/note-events.ts` | Central event bus aggregating note on/off across loopers |
| `app/session-transport.ts` | Shared playback transport (beat boundaries, measures) |
| `app/share-payloads.ts` | Encode/decode track state for URL sharing |
| `app/carousel-bridge.ts` | Decoupled bridge to hide/show carousel (fullscreen support) |
| `app/seigaiha-bridge.ts` | Controls background animation (randomness, detune) |
| `fretboard-logic.ts` | Fretboard state: root, scale, chord, dot positions |
| `utils.ts` | `clamp()`, `getOrCreateAudioContext()` |
| `main.ts` | App entry point — registers Wild Tuna, handles fullscreen |
