import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  {
    path: 'analysis/:id',
    loadComponent: () => import('./pages/results/results').then((m) => m.ResultsPage),
  },
  {
    path: 'analysis/:id/file/:fileId',
    loadComponent: () => import('./pages/file-detail/file-detail').then((m) => m.FileDetailPage),
  },
  {
    // Public share link. Resolves by slug rather than run id so the id stays
    // unguessable and the two access paths cannot be confused.
    path: 'shared/:slug',
    loadComponent: () => import('./pages/results/results').then((m) => m.ResultsPage),
  },
  { path: '**', redirectTo: '' },
];
