import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { parseRepoUrl } from '@debtmap/shared';
import { TranslatePipe } from '@ngx-translate/core';
import { AnalysisService, toUiMessage } from '../../core/analysis.service';
import type { UiMessage } from '../../core/ui-message';

@Component({
  selector: 'app-home',
  imports: [FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  private readonly analyses = inject(AnalysisService);
  private readonly router = inject(Router);

  protected readonly repoUrl = signal('');
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<UiMessage | null>(null);

  protected submit(): void {
    const value = this.repoUrl().trim();

    // Validated with the same parser the API and the analysis engine use, so
    // an obviously wrong URL is rejected without a round trip and the rules
    // cannot drift between client and server.
    if (!parseRepoUrl(value)) {
      this.errorMessage.set({ key: 'home.invalidUrl' });
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.analyses.start(value).subscribe({
      next: (run) => {
        void this.router.navigate(['/analysis', run.id]);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(toUiMessage(error));
      },
    });
  }
}
