import { Project, SyntaxKind, type Node, type SourceFile } from 'ts-morph';
import type { AstFileMetrics } from './types';

/**
 * Parses without type information.
 *
 * The cloned repository has no `node_modules` and we will never run
 * `npm install` on untrusted code, so a type checker would resolve nothing.
 * That costs us nothing here: cyclomatic complexity and nesting depth are
 * purely syntactic properties.
 */
export function createParseProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      noResolve: true,
      noLib: true,
    },
  });
}

/** Nodes that introduce a branch in the control-flow graph. */
const DECISION_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
]);

/** Nodes that open a new level of indentation a reader has to hold in mind. */
const NESTING_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.TryStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
]);

export function measureFile(project: Project, filePath: string, content: string): AstFileMetrics {
  let sourceFile: SourceFile | undefined;

  try {
    sourceFile = project.createSourceFile(filePath, content, { overwrite: true });

    return {
      loc: countCodeLines(content),
      cyclomaticComplexity: computeCyclomaticComplexity(sourceFile),
      maxNestingDepth: computeMaxNesting(sourceFile),
    };
  } catch (error) {
    return {
      loc: countCodeLines(content),
      cyclomaticComplexity: 0,
      maxNestingDepth: 0,
      parseError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Released immediately: holding 5,000 ASTs at once is the difference
    // between a few hundred megabytes and an out-of-memory kill on a small
    // container.
    if (sourceFile) project.removeSourceFile(sourceFile);
  }
}

function computeCyclomaticComplexity(sourceFile: SourceFile): number {
  let complexity = 1;

  sourceFile.forEachDescendant((node) => {
    const kind = node.getKind();

    if (DECISION_KINDS.has(kind)) {
      complexity += 1;
      return;
    }

    // `default:` is not a branch — it is the fall-through, already counted by
    // the base path.
    if (kind === SyntaxKind.CaseClause) {
      complexity += 1;
      return;
    }

    // Short-circuiting operators each add a path through the expression.
    if (kind === SyntaxKind.BinaryExpression && isShortCircuit(node)) {
      complexity += 1;
    }
  });

  return complexity;
}

function isShortCircuit(node: Node): boolean {
  const binary = node.asKind(SyntaxKind.BinaryExpression);
  if (!binary) return false;

  const operator = binary.getOperatorToken().getKind();
  return (
    operator === SyntaxKind.AmpersandAmpersandToken ||
    operator === SyntaxKind.BarBarToken ||
    operator === SyntaxKind.QuestionQuestionToken
  );
}

function computeMaxNesting(sourceFile: SourceFile): number {
  let max = 0;

  const walk = (node: Node, depth: number): void => {
    const next = NESTING_KINDS.has(node.getKind()) ? depth + 1 : depth;
    if (next > max) max = next;
    node.forEachChild((child) => walk(child, next));
  };

  sourceFile.forEachChild((child) => walk(child, 0));
  return max;
}

/**
 * Counts lines that carry code: blank lines and comment-only lines are
 * excluded, so a well-documented file is not penalised for its documentation.
 * This is a line scan rather than an AST walk because it must also work for the
 * files that failed to parse.
 */
export function countCodeLines(content: string): number {
  let count = 0;
  let inBlockComment = false;

  for (const rawLine of content.split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlockComment = false;
      line = line.slice(end + 2).trim();
      if (!line) continue;
    }

    if (line.startsWith('//')) continue;

    if (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2);
      if (end === -1) {
        inBlockComment = true;
        continue;
      }
      const remainder = line.slice(end + 2).trim();
      if (!remainder) continue;
    }

    count += 1;
  }

  return count;
}
