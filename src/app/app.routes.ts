import { Routes } from '@angular/router';
import { DesignerComponent } from './pages/designer/designer.component';

export const routes: Routes = [
  { path: '', component: DesignerComponent },
  { path: '**', redirectTo: '' },
];
