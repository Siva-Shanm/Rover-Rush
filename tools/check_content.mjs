#!/usr/bin/env node
/**
 * Content checks (dev time). Verifies the reviewed mission content in content/*.json
 * against the supplied scripts and the correction ledger. The scripts are parsed
 * here ONLY to verify wording; the game never parses Markdown at runtime.
 *
 * usage: node tools/check_content.mjs        (exit code 1 on any failure)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const MISSIONS = ['sojourner', 'spirit', 'opportunity'];

const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) errors.push(msg); };
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/** All quoted/bodied strings of a script (verification only). */
function scriptStrings(md) {
    const out = new Set();
    const unesc = (s) => s.replace(/\\\[/g, '[').replace(/\\\]/g, ']').trim();
    for (const raw of md.split('\n')) {
        const line = unesc(raw);
        const q = line.match(/^\s*[*-]?\s*(?:\*\*[^*]+\*\*:?\s*)?"(.*)"\s*$/);          // tutorials, fragments
        if (q) out.add(q[1]);
        const logLine = line.match(/^\s+"(.*)"\s*$/);                                    // checkpoint logs
        if (logLine) out.add(logLine[1]);
        const cx = line.match(/^\s*\*\s+\*\*[^*]+:\*\*\s*(.+?)\s*$/);                    // codex bodies
        if (cx) out.add(cx[1]);
        const qq = line.match(/^\s*\*\s+\*\*Question \d+:\*\*\s*(.+?)\s*$/);              // quiz questions
        if (qq) out.add(qq[1]);
        const opt = line.match(/^\s*\*\s+\*?[A-C]\)\s*(.+?)(?:\s*\(Correct\))?\*?\s*$/);   // quiz options
        if (opt) out.add(opt[1]);
    }
    return out;
}

const ledger = json('content/corrections.json');
const byRepl = new Map();   // replacement text -> ledger entries (same wording may serve several missions)
for (const e of ledger.entries) byRepl.set(e.replacement, [...(byRepl.get(e.replacement) || []), e]);
const PREFIX = { sojourner: 'soj-', spirit: 'spi-', opportunity: 'opp-' };
const usedLedger = new Set();
const allIds = new Set();
const allFragmentText = [];
const facts = json('content/facts.json');

for (const id of MISSIONS) {
    const c = json(`content/${id}.json`);
    const md = read(c.sourceScript);
    const S = scriptStrings(md);
    const where = (x) => `[${id}] ${x}`;

    /** reviewed string must be verbatim from the script or a ledger replacement */
    const verify = (sid, text) => {
        ok(typeof text === 'string' && text.trim().length > 0, where(`${sid}: empty text`));
        if (S.has(text)) return;
        const cands = byRepl.get(text) || [];
        const e = cands.find((x) => x.id.startsWith(PREFIX[id])) || cands[0];
        ok(!!e, where(`${sid}: not in script and not in ledger: "${text}"`));
        if (e) {
            usedLedger.add(e.id);
            ok(e.original === '' || S.has(e.original), where(`${sid}: ledger original not found verbatim in script: "${e.original}"`));
            ok(!!ledger.sources[e.source], where(`${sid}: ledger source key '${e.source}' unknown`));
        }
    };
    const uid = (x) => { ok(!allIds.has(x), where(`duplicate id ${x}`)); allIds.add(x); };

    ok(c.id === id, where('id mismatch'));
    // tutorials
    ok(c.tutorials.length === 4, where(`expected 4 tutorials, got ${c.tutorials.length}`));
    c.tutorials.forEach((t, i) => {
        uid(t.id); ok(t.slot === i + 1, where(`${t.id}: slot order`));
        verify(t.id, t.text);
        ok(Array.isArray(t.accepts) && t.accepts.length > 0, where(`${t.id}: accepts`));
        if (t.note) verify(`${t.id}.note`, t.note);
    });
    // fragments
    ok(c.fragments.length === 10, where(`expected exactly 10 fragments, got ${c.fragments.length}`));
    const ns = new Set();
    c.fragments.forEach((f) => {
        uid(f.id); ns.add(f.n);
        ok(words(f.displayText) <= 12, where(`${f.id}: displayText has ${words(f.displayText)} words (>12)`));
        if (f.fullText) { verify(`${f.id}.full`, f.fullText); } else { verify(f.id, f.displayText); }
        allFragmentText.push(f.displayText + ' ' + (f.fullText || ''));
    });
    ok(ns.size === 10 && [...ns].every((n) => n >= 1 && n <= 10), where('fragment numbers must be 1..10 unique'));
    // checkpoints
    ok(c.checkpoints.length === 3, where('expected 3 checkpoints'));
    [0.25, 0.5, 0.75].forEach((p, i) => ok(c.checkpoints[i] && c.checkpoints[i].p === p, where(`checkpoint ${i + 1} must be at p=${p}`)));
    c.checkpoints.forEach((cp) => { uid(cp.id); verify(cp.id, cp.log); ok(/^SYSTEM LOG 0\d:/.test(cp.log), where(`${cp.id}: log prefix`)); });
    // quiz
    ok(c.quiz.length === 2, where('expected 2 quiz questions'));
    c.quiz.forEach((q) => {
        uid(q.id); verify(q.id, q.question);
        ok(q.options.length === 3, where(`${q.id}: expected 3 options`));
        q.options.forEach((o) => { uid(o.id); verify(o.id, o.text); });
        const correct = q.options.find((o) => o.id === q.correct);
        ok(!!correct, where(`${q.id}: correct id '${q.correct}' is not an option`));
        ok(q.options.filter((o) => o.id === q.correct).length === 1, where(`${q.id}: exactly one correct option`));
        const log = c.checkpoints.find((cp) => cp.id === q.taughtBy);
        ok(!!log, where(`${q.id}: taughtBy '${q.taughtBy}' is not a checkpoint`));
        if (log && correct) {
            ok(log.log.toLowerCase().includes(q.taughtPhrase.toLowerCase()), where(`${q.id}: taught phrase not in ${q.taughtBy}`));
            ok(correct.text.toLowerCase().includes(q.taughtPhrase.toLowerCase()), where(`${q.id}: taught phrase not in correct option`));
        }
        ok(typeof q.explanation === 'string' && q.explanation.length > 10, where(`${q.id}: explanation`));
    });
    // codex
    ok(c.codex.sections.length >= 4, where('codex needs >= 4 sections'));
    c.codex.sections.forEach((s) => { uid(s.id); verify(s.id, s.body); });
    (c.codex.notes || []).forEach((n, i) => verify(`${id}.note${i}`, n));
}

// ledger: every entry must be used, originals must differ from replacements
for (const e of ledger.entries) {
    ok(usedLedger.has(e.id), `[ledger] entry ${e.id} is not used by any content string`);
    ok(e.original !== e.replacement, `[ledger] ${e.id}: replacement identical to original`);
    ok(/^https:\/\/science\.nasa\.gov\//.test(ledger.sources[e.source] || ''), `[ledger] ${e.id}: source must be an official science.nasa.gov URL`);
}

// facts: >= 1 per rover, official sources, add info absent from every fragment
for (const r of MISSIONS) ok(facts.facts.some((f) => f.rover === r), `[facts] no fact for ${r}`);
const frag = allFragmentText.join(' \n ').toLowerCase();
for (const f of facts.facts) {
    ok(!allIds.has(f.id), `[facts] id ${f.id} collides`); allIds.add(f.id);
    ok(/^https:\/\/science\.nasa\.gov\//.test(f.source), `[facts] ${f.id}: source must be science.nasa.gov`);
    for (const kw of f.notInFragments) {
        ok(f.text.toLowerCase().includes(kw.toLowerCase()), `[facts] ${f.id}: keyword '${kw}' not in fact text`);
        ok(!frag.includes(kw.toLowerCase()), `[facts] ${f.id}: keyword '${kw}' already appears in a memory fragment`);
    }
}

// Spirit V1 text must be gone from everything the game ships
let v1 = '';
try { v1 = execSync('git show cdd546b^:game_content_script_spirit_level.md', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { /* history unavailable */ }
const v1Strings = [...scriptStrings(v1)].filter((s) => s.length > 25 && !scriptStrings(read('rover_rush_spirit_script.md')).has(s));
const shipped = [];
const walk = (dir) => {
    for (const n of readdirSync(join(ROOT, dir))) {
        const p = join(dir, n);
        if (statSync(join(ROOT, p)).isDirectory()) walk(p);
        else if (/\.(js|json|html|css)$/.test(n)) shipped.push(p);
    }
};
['js', 'assets'].forEach(walk); shipped.push('index.html');
ok(v1Strings.length > 0 || !v1, '[v1] could not extract V1 strings from git history');
for (const p of shipped) {
    const txt = read(p);
    for (const s of v1Strings) ok(!txt.includes(s), `[v1] runtime file ${p} still contains V1 text: "${s.slice(0, 60)}…"`);
}

console.log(`content checks: ${checks} assertions, ${errors.length} failure(s)` + (v1 ? `, ${v1Strings.length} V1 strings scanned in ${shipped.length} shipped files` : ', V1 history unavailable'));
if (errors.length) { errors.forEach((e) => console.log('  FAIL ' + e)); process.exit(1); }
