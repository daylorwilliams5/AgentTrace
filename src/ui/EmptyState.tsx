import { FIXTURE_PAIRS } from '../fixtures';
import { useApp } from '../state/store';
import { pickFiles } from '../io/readFiles';

/**
 * Not an onboarding flow — the import surface itself, with the fixtures wired
 * in so the compare interaction is one click away. Everything stays local: the
 * only I/O this application performs is reading a file you hand it.
 */
export function EmptyState() {
  const load = useApp((s) => s.load);

  return (
    <div className="at-empty">
      <div className="at-empty__card">
        <div className="at-empty__title">agenttrace</div>
        <div className="at-empty__body">
          A diff tool for agent runs.
          <br />
          Drop in two runs of the same task to see exactly where their behavior differs.
          <br />
          <br />
          Local only. Nothing leaves your browser.
        </div>

        <div className="at-empty__drop">
          drop <span className="at-muted">agenttrace/v1</span> .json or Claude Code .jsonl files here
          <br />
          <span className="at-dim">two files at once opens compare directly</span>
        </div>

        <div className="at-empty__row" style={{ marginBottom: 18 }}>
          <button
            className="at-btn"
            onClick={() => {
              void pickFiles().then((r) => load(r.filter((f) => !f.parseError)));
            }}
          >
            choose files…
          </button>
        </div>

        <div className="at-rail__heading" style={{ marginBottom: 8 }}>
          <span>try a sample</span>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {FIXTURE_PAIRS.map((p) => (
            <button
              key={p.key}
              className="at-sample"
              onClick={() =>
                load([
                  { fileName: `${p.key}.a.json`, raw: p.a },
                  { fileName: `${p.key}.b.json`, raw: p.b },
                ])
              }
            >
              <span className="at-sample__key">{p.key}</span>
              <span className="at-sample__desc">{p.title}</span>
              <span className="at-sample__go">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
