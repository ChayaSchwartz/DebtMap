import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CdkTableModule } from '@angular/cdk/table';
import { RouterLink } from '@angular/router';
import {
  isTerminal,
  toRiskBand,
  type AnalysisRunResponse,
  type FileMetricResponse,
  type RiskBand,
  type ScanOutcome,
  type SecurityFinding,
  type Severity,
} from '@debtmap/shared';
import { TranslatePipe } from '@ngx-translate/core';
import { Subscription, interval, switchMap } from 'rxjs';
import { AnalysisService, toUiMessage } from '../../core/analysis.service';
import { SEVERITY_BANDS, scanReasonMessage, type UiMessage } from '../../core/ui-message';

type SortKey = 'bugPronenessScore' | 'securityScore' | 'churnCommits' | 'cyclomaticComplexity';

const POLL_INTERVAL_MS = 2000;

/**
 * A repository can carry hundreds of dependency advisories. The list is sorted
 * worst-first, so the tail adds length without adding information; the full
 * count is still shown so nothing looks hidden.
 */
const MAX_REPOSITORY_FINDINGS_SHOWN = 25;

@Component({
  selector: 'app-results',
  imports: [CdkTableModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class ResultsPage {
  private readonly analyses = inject(AnalysisService);
  private readonly router = inject(Router);

  /** Bound from the route: `analysis/:id` or the public `shared/:slug`. */
  readonly id = input<string>();
  readonly slug = input<string>();

  protected readonly run = signal<AnalysisRunResponse | null>(null);
  protected readonly errorMessage = signal<UiMessage | null>(null);
  protected readonly shareCopied = signal(false);
  protected readonly sortKey = signal<SortKey>('bugPronenessScore');

  protected readonly columns = ['path', 'bugProneness', 'security', 'churn', 'bugs', 'complexity'];

  private poll?: Subscription;

  protected readonly isRunning = computed(() => {
    const run = this.run();
    return run !== null && !isTerminal(run.status);
  });

  /**
   * Findings that belong to the repository rather than to any file: vulnerable
   * dependencies, and secrets on paths outside the analysed set. Without this
   * panel a repository can show a security score of 90 with no file that
   * explains it.
   */
  protected readonly repositoryFindings = computed<SecurityFinding[]>(() =>
    (this.run()?.repositoryFindings ?? []).slice(0, MAX_REPOSITORY_FINDINGS_SHOWN),
  );

  protected readonly repositoryFindingsHidden = computed(
    () => (this.run()?.repositoryFindings.length ?? 0) - this.repositoryFindings().length,
  );

  protected readonly sortedFiles = computed<FileMetricResponse[]>(() => {
    const files = this.run()?.files ?? [];
    const key = this.sortKey();
    return [...files].sort((a, b) => b[key] - a[key] || a.path.localeCompare(b.path));
  });

  constructor() {
    effect((onCleanup) => {
      const runId = this.id();
      const shareSlug = this.slug();

      this.poll?.unsubscribe();
      this.run.set(null);
      this.errorMessage.set(null);

      if (shareSlug) {
        this.load(() => this.analyses.shared(shareSlug));
      } else if (runId) {
        this.load(() => this.analyses.result(runId));
        this.startPolling(runId);
      }

      onCleanup(() => this.poll?.unsubscribe());
    });
  }

  private load(request: () => ReturnType<AnalysisService['result']>): void {
    request().subscribe({
      next: (run) => this.run.set(run),
      error: (error: unknown) => this.errorMessage.set(toUiMessage(error)),
    });
  }

  /**
   * Polls the lightweight status endpoint rather than the full result, then
   * fetches the result once. Re-downloading thousands of file rows every two
   * seconds to watch a progress bar move would be wasteful on both ends.
   */
  private startPolling(runId: string): void {
    this.poll = interval(POLL_INTERVAL_MS)
      .pipe(switchMap(() => this.analyses.status(runId)))
      .subscribe({
        next: (status) => {
          const current = this.run();
          if (current) {
            this.run.set({ ...current, ...status });
          }

          if (isTerminal(status.status)) {
            this.poll?.unsubscribe();
            if (status.status === 'COMPLETED') {
              this.load(() => this.analyses.result(runId));
            }
          }
        },
        error: () => this.poll?.unsubscribe(),
      });
  }

  protected band(score: number): RiskBand {
    return toRiskBand(score);
  }

  protected severityBand(severity: Severity): RiskBand {
    return SEVERITY_BANDS[severity];
  }

  protected scanReason(outcome: ScanOutcome): UiMessage | null {
    return outcome.reason ? scanReasonMessage(outcome.reason) : null;
  }

  /** Runs that failed before error codes existed carry only the English text. */
  protected runError(run: AnalysisRunResponse): UiMessage {
    return { key: `runError.${run.errorCode ?? 'unknown'}` };
  }

  /** Where a repository-level finding came from, in one line. */
  protected findingSource(finding: SecurityFinding): string {
    if (finding.packageName) {
      return `${finding.packageName}@${finding.vulnerableVersion ?? '?'}`;
    }

    const location = finding.line ? `${finding.filePath}:${finding.line}` : (finding.filePath ?? '');
    return finding.commitSha ? `${location} (${finding.commitSha.slice(0, 10)})` : location;
  }

  protected setSort(key: SortKey): void {
    this.sortKey.set(key);
  }

  protected reanalyse(): void {
    const url = this.run()?.repository.url;
    if (!url) return;

    this.analyses.start(`https://${url}`).subscribe({
      next: (created) => void this.router.navigate(['/analysis', created.id]),
      error: (error: unknown) => this.errorMessage.set(toUiMessage(error)),
    });
  }

  protected async share(): Promise<void> {
    const slug = this.run()?.shareSlug;
    if (!slug) return;

    const link = `${location.origin}/shared/${slug}`;
    try {
      await navigator.clipboard.writeText(link);
      this.shareCopied.set(true);
      setTimeout(() => this.shareCopied.set(false), 2500);
    } catch {
      // Clipboard access can be denied; the link is still in the address bar
      // of the share route, so this is not worth an error message.
    }
  }
}
