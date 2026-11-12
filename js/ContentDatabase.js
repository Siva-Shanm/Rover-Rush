/**
 * ContentDatabase
 * ---------------------------------------------------------------------------
 * Single source of truth for every string the player reads.
 * Text is copied verbatim from `game_content_script_spirit_level.md`.
 * Nothing in GameScene / UIController hard-codes narrative copy.
 */
const ContentDatabase = Object.freeze({
    meta: {
        title: 'ROVER RUSH',
        subtitle: 'SPIRIT LEVEL',
        missionTag: 'MER-A // GUSEV CRATER // SOL 1',
        challenge: 'NASA Space Apps Challenge 2026',
    },

    // 1. Tutorial slow-mo sequences (game drops to 25% speed)
    tutorials: {
        crater:   { key: 'SPACE', text: 'Jump! Press [SPACE] to clear gaps and craters.' },
        silica:   { key: 'SHIFT', text: 'Obstacle ahead! Press [SHIFT] to Trench-Scrape Slide underneath.' },
        dustDevil:{ key: 'SHIFT / SPACE', text: 'Warning: Dust Devils drain health! Slide or Jump to evade.' },
        sandTrap: { key: 'E / SHIFT', text: 'Troy Sand Traps slow you down. Boost or Slide to escape!' },
    },

    // 2. Memory fragments (cyan data drives) - index 1..10
    fragments: {
        1:  'Launched June 10, 2003. Landed Jan 3, 2004!',
        2:  'Originally a 90-day mission. Lasted over 6 years!',
        3:  'Exploring Gusev Crater to search for ancient water.',
        4:  'Found volcanic rocks near Home Plate!',
        5:  'Photographed dust devils, revealing Martian weather patterns.',
        6:  'Right-front wheel jammed in 2009. Had to drive backward!',
        7:  'Dragging wheel scraped soil, finding 90% pure silica!',
        8:  'Pure silica proves ancient hot springs existed here.',
        9:  'Trapped in soft sand at Troy. Became a stationary station.',
        10: 'Final communication sent March 2010. Mission complete.',
    },

    // 3. Checkpoint terminals
    checkpoints: {
        1: {
            title: 'CHECKPOINT 1 // THE ARRIVAL',
            log: 'SYSTEM LOG 01: I am Spirit, a robotic geologist. NASA sent me to explore Gusev Crater. I was only supposed to survive for 90 Martian days, but my solar panels are holding strong. Let\'s see what secrets this red dirt holds.',
        },
        2: {
            title: 'CHECKPOINT 2 // THE GEOLOGIST',
            log: 'SYSTEM LOG 02: The terrain is getting rougher. I\'ve found evidence of ancient volcanic eruptions near Home Plate. Dust is accumulating on my solar panels, but local Martian dust devils occasionally sweep them clean for me!',
        },
        3: {
            title: 'CHECKPOINT 3 // THE GREAT DISCOVERY',
            log: 'SYSTEM LOG 03: Disaster turned into discovery! My front-right wheel stopped working, forcing me to drag it as I drive backward. But this accident was lucky—the dragging wheel scraped away the topsoil, revealing pure silica! This is massive proof that hot springs once existed here.',
        },
    },

    // 4. End-of-level decryption quiz
    quiz: {
        title: 'DECRYPTION PROTOCOL',
        intro: 'Answer correctly to decrypt Spirit\'s final transmission.',
        questions: [
            {
                q: 'What did Spirit\'s dragging, broken wheel accidentally uncover?',
                options: ['Martian Ice', 'Pure Silica', 'Alien Technology'],
                correct: 1,
            },
            {
                q: 'How long was Spirit\'s original mission supposed to last?',
                options: ['90 Days', '14 Years', '6 Months'],
                correct: 0,
            },
        ],
        wrong: 'DECRYPTION FAILED. Re-examine the data and try again.',
        success: 'DECRYPTION COMPLETE. Archive File MER-A unlocked in the Codex.',
    },

    // 5. Codex (main-menu archive, unlocked after completing the level)
    codex: {
        file: 'Archive File: MER-A (Spirit)',
        sections: [
            {
                heading: 'Mission Profile',
                body: 'Spirit (Mars Exploration Rover - A) was launched by NASA on June 10, 2003, and landed in Gusev Crater on January 3, 2004. Nicknamed the "robotic geologist," its primary mission was to study rocks, soil, and the environment to search for evidence of ancient water.',
            },
            {
                heading: 'Engineering Marvel',
                body: 'Designed for a 90-Martian-day mission, Spirit operated for over 6 years—more than 25 times its planned duration! It traveled a total distance of approximately 7.73 km, powered entirely by solar panels and rechargeable batteries.',
            },
            {
                heading: 'Major Discoveries',
                body: 'Spirit revolutionized our understanding of Mars. It found rocks altered by water, proving Mars was once much wetter. In 2007, a broken wheel inadvertently dug a trench that revealed almost pure silica, suggesting the past presence of ancient hot springs or steam vents. It also discovered sulfur-rich soil and captured groundbreaking photographs of dust devils.',
            },
            {
                heading: 'Final Rest',
                body: 'In 2009, Spirit became trapped in soft soil (an area named Troy). Unable to maneuver its solar panels toward the sun for the harsh Martian winter, it eventually stopped communicating with Earth in March 2010. The mission officially concluded on May 25, 2011, leaving behind a legacy that proved Mars once had conditions capable of supporting microbial life.',
            },
        ],
    },

    // UI chrome (not narrative)
    ui: {
        start: 'BEGIN MISSION',
        codex: 'CODEX',
        codexLocked: 'CODEX [LOCKED]',
        confirm: 'CONFIRM',
        close: 'CLOSE',
        retry: 'RETRY FROM CHECKPOINT',
        menu: 'MAIN MENU',
        signalLost: 'SIGNAL LOST',
        signalLostSub: 'Spirit has taken too much damage.',
        fragmentHeader: 'MEMORY FRAGMENT RECOVERED',
        controls: '[SPACE] Jump  •  [SHIFT] Slide  •  [E] / hold [SPACE] Boost',
        missionComplete: 'MISSION COMPLETE',
        incoming: 'INCOMING TRANSMISSION',
        terminalHeader: 'MER-A TERMINAL',
    },
});
