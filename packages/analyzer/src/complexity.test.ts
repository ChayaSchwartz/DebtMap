import { beforeAll, describe, expect, it } from 'vitest';
import type { Project } from 'ts-morph';
import { countCodeLines, createParseProject, measureFile } from './complexity';

let project: Project;
beforeAll(() => {
  project = createParseProject();
});

const measure = (code: string) => measureFile(project, '/sample.ts', code);

describe('cyclomaticComplexity', () => {
  it('is 1 for straight-line code', () => {
    expect(measure('const a = 1;\nconst b = a + 1;\n').cyclomaticComplexity).toBe(1);
  });

  it('counts each branching construct once', () => {
    expect(measure('if (a) { b(); }').cyclomaticComplexity).toBe(2);
    expect(measure('for (const x of xs) { f(x); }').cyclomaticComplexity).toBe(2);
    expect(measure('while (a) { b(); }').cyclomaticComplexity).toBe(2);
    expect(measure('const v = a ? b : c;').cyclomaticComplexity).toBe(2);
  });

  it('counts short-circuit operators as separate paths', () => {
    expect(measure('const v = a && b;').cyclomaticComplexity).toBe(2);
    expect(measure('const v = a || b;').cyclomaticComplexity).toBe(2);
    expect(measure('const v = a ?? b;').cyclomaticComplexity).toBe(2);
    expect(measure('const v = a && b && c;').cyclomaticComplexity).toBe(3);
  });

  it('counts case clauses but not the default fall-through', () => {
    const code = `
      switch (x) {
        case 1: return 'a';
        case 2: return 'b';
        default: return 'c';
      }
    `;
    // Base 1 + two case clauses.
    expect(measure(code).cyclomaticComplexity).toBe(3);
  });

  it('counts a catch clause, since it is a distinct path', () => {
    expect(measure('try { f(); } catch (e) { g(); }').cyclomaticComplexity).toBe(2);
  });

  it('accumulates across a realistically tangled function', () => {
    const code = `
      function handle(input) {
        if (!input) return null;
        for (const item of input.items) {
          if (item.valid && item.ready) {
            try { process(item); } catch (e) { report(e); }
          } else if (item.retry || item.pending) {
            queue(item);
          }
        }
        return input.done ? 'done' : 'partial';
      }
    `;
    expect(measure(code).cyclomaticComplexity).toBeGreaterThan(8);
  });
});

describe('maxNestingDepth', () => {
  it('is 0 for a flat file', () => {
    expect(measure('const a = 1;').maxNestingDepth).toBe(0);
  });

  it('grows with each nested control structure', () => {
    expect(measure('if (a) { b(); }').maxNestingDepth).toBe(1);
    expect(measure('if (a) { if (b) { c(); } }').maxNestingDepth).toBe(2);
    expect(measure('if (a) { for (;;) { while (c) { d(); } } }').maxNestingDepth).toBe(3);
  });

  it('reports the deepest branch, not the last one', () => {
    const code = `
      if (a) { if (b) { if (c) { deep(); } } }
      if (d) { shallow(); }
    `;
    expect(measure(code).maxNestingDepth).toBe(3);
  });

  it('does not count sequential blocks as nesting', () => {
    expect(measure('if (a) { x(); }\nif (b) { y(); }').maxNestingDepth).toBe(1);
  });
});

describe('countCodeLines', () => {
  it('ignores blank lines', () => {
    expect(countCodeLines('const a = 1;\n\n\nconst b = 2;\n')).toBe(2);
  });

  it('ignores line comments', () => {
    expect(countCodeLines('// explanation\nconst a = 1;\n')).toBe(1);
  });

  it('ignores block comments spanning several lines', () => {
    expect(countCodeLines('/*\n * doc\n */\nconst a = 1;\n')).toBe(1);
  });

  it('does not penalise a heavily documented file', () => {
    const documented = '/** One. */\n/** Two. */\n/** Three. */\nexport const a = 1;\n';
    expect(countCodeLines(documented)).toBe(1);
  });

  it('counts code that follows a block comment on the same line', () => {
    expect(countCodeLines('/* note */ const a = 1;\n')).toBe(1);
  });
});

describe('measureFile', () => {
  it('still reports line count when the source cannot be parsed', () => {
    const result = measure('function ( { { { unparseable');
    expect(result.loc).toBeGreaterThan(0);
  });

  it('handles an empty file without throwing', () => {
    const result = measure('');
    expect(result.loc).toBe(0);
    expect(result.cyclomaticComplexity).toBe(1);
    expect(result.maxNestingDepth).toBe(0);
  });
});
