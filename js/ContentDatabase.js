/**
 * ContentDatabase — UI chrome strings only.
 * ---------------------------------------------------------------------------
 * Mission narrative (tutorials, fragments, logs, quizzes, Codex) is compiled
 * from the reviewed scripts into assets/data/levels/<id>.json by
 * tools/build_levels.mjs; menu facts live in js/data/GameData.js. Nothing
 * mission-specific is hard-coded here.
 */
const ContentDatabase = Object.freeze({
    meta: {
        title: 'ROVER RUSH',
        subtitle: 'THREE MISSIONS TO MARS',
        challenge: 'NASA Space Apps Challenge 2026',
    },
    abilityNames: {
        trenchScrapeSlide: 'Trench-Scrape Slide',
        airbagBounce: 'Airbag Bounce',
        solarWindBoost: 'Solar Wind Boost',
    },
    ui: {
        loading: 'LOADING MISSION DATA',
        loaded: 'MISSION DATA READY',
        loadFailed: 'Mission data failed to load.',
        retry: 'RETRY',
        play: 'LAUNCH',
        codex: 'CODEX',
        codexLocked: 'CODEX LOCKED',
        didYouKnow: 'DID YOU KNOW?',
        source: 'Source',
        bestProgress: 'Best progress',
        completed: 'Completed',
        fastest: 'Fastest clear',
        noClear: 'No clear time yet',
        confirm: 'CONFIRM',
        continue: 'CONTINUE',
        skip: 'SKIP',
        close: 'CLOSE',
        retryCheckpoint: 'RETRY FROM CHECKPOINT',
        menu: 'MAIN MENU',
        signalLost: 'SIGNAL LOST',
        signalLostSub: 'The rover has taken too much damage.',
        fragmentHeader: 'MEMORY FRAGMENT RECOVERED',
        terminalHeader: 'ROVER TERMINAL',
        quizTitle: 'DECRYPTION PROTOCOL',
        quizIntro: 'Answer both keys correctly to decrypt the archive.',
        quizWrong: 'DECRYPTION FAILED.',
        quizAccepted: '> KEY ACCEPTED',
        decrypted: 'DECRYPTION COMPLETE',
        archiveUnlocked: 'Archive unlocked in the Codex.',
        missionComplete: 'MISSION COMPLETE',
        clearTime: 'Clear time',
        trainingSim: '// TRAINING SIM - TIME DILATION 25%',
        controls: '[SPACE] Jump  •  [SHIFT] Rover ability  •  Spirit: [E] / hold [SPACE] Boost',
        sourcesHeading: 'Sources',
        notesHeading: 'Notes',
    },
});
