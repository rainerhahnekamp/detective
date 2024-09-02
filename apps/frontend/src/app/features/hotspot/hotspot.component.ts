import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { HotspotService } from './hotspot.service';
import {
  AggregatedHotspot,
  AggregatedHotspotsResult,
  ComplexityMetric,
  FlatHotspot,
  HotspotCriteria,
  HotspotResult,
  initAggregatedHotspotsResult,
  initHotspotResult,
} from './hotspot-result';
import { MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { lastSegments } from '../../utils/segments';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import {
  catchError,
  combineLatest,
  filter,
  Observable,
  of,
  startWith,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { EventService } from '../../utils/event.service';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { LimitsComponent } from '../../ui/limits/limits.component';
import { initLimits } from '../../model/limits';
import { MatSelectModule } from '@angular/material/select';
import { StatusStore } from '../../data/status.store';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { debounceTimeSkipFirst } from '../../utils/debounce';
import { onceEffect } from '../../utils/effects';
import { injectShowError } from '../../utils/error-handler';

interface Option {
  id: ComplexityMetric;
  label: string;
}

@Component({
  selector: 'app-hotspot',
  standalone: true,
  imports: [
    MatTableModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressBarModule,
    MatPaginatorModule,
    LimitsComponent,
    FormsModule,
  ],
  templateUrl: './hotspot.component.html',
  styleUrl: './hotspot.component.css',
})
export class HotspotComponent {
  private hotspotService = inject(HotspotService);
  private eventService = inject(EventService);

  private statusStore = inject(StatusStore);
  private showError = injectShowError();

  aggregatedResult = initAggregatedHotspotsResult;
  dataSource = new MatTableDataSource<AggregatedHotspot>();
  detailDataSource = new MatTableDataSource<FlatHotspot>();

  hotspotResult = initHotspotResult;
  selectedRow: AggregatedHotspot | null = null;

  columnsToDisplay = ['module', 'count'];
  detailColumns = ['fileName', 'commits', 'complexity', 'score'];

  totalCommits = this.statusStore.commits;
  minScoreControl = signal(10);
  limits = signal(initLimits);
  metric = signal<ComplexityMetric>('Length');

  metricOptions: Option[] = [
    { id: 'Length', label: 'File Length' },
    { id: 'McCabe', label: 'Cyclomatic Complexity' },
  ];

  selectedModule = signal('');
  loadingAggregated = signal(false);
  loadingHotspots = signal(false);

  paginator = viewChild(MatPaginator);

  constructor() {
    const loadAggregatedEvents = [
      this.eventService.filterChanged.pipe(startWith(null)),
      toObservable(this.minScoreControl).pipe(debounceTimeSkipFirst(300)),
      toObservable(this.limits).pipe(debounceTimeSkipFirst(300)),
      toObservable(this.metric),
    ];

    const loadHotspotEvent = [
      ...loadAggregatedEvents,
      toObservable(this.selectedModule),
    ];

    const aggregated$ = combineLatest(loadAggregatedEvents).pipe(
      switchMap(() => this.loadAggregated())
    );

    const hotspots$ = combineLatest(loadHotspotEvent).pipe(
      filter(() => !!this.selectedModule()),
      switchMap(() => this.loadHotspots())
    );

    const aggregated = toSignal(aggregated$);
    const hotspots = toSignal(hotspots$);

    effect(() => {
      const result = aggregated();
      if (result) {
        this.aggregatedResult = result;
        this.dataSource.data = this.formatAggregated(result.aggregated);
      }
    });

    effect(() => {
      const result = hotspots();
      if (result) {
        this.hotspotResult = result;
        this.detailDataSource.data = this.formatHotspots(result.hotspots);
      }
    });

    onceEffect(() => {
      const paginator = this.paginator();
      if (paginator) {
        this.detailDataSource.paginator = paginator;
      }
    });
  }

  selectRow(row: AggregatedHotspot, index: number) {
    const selectModule = this.aggregatedResult.aggregated[index].module;
    this.selectedRow = row;
    this.selectedModule.set(selectModule);
  }

  formatAggregated(hotspot: AggregatedHotspot[]): AggregatedHotspot[] {
    return hotspot.map((hs) => ({
      ...hs,
      module: lastSegments(hs.module, 3),
    }));
  }

  formatHotspots(hotspot: FlatHotspot[]): FlatHotspot[] {
    return hotspot.map((hs) => ({
      ...hs,
      fileName: trimSegments(hs.fileName, this.selectedRow?.module || ''),
    }));
  }

  private loadAggregated(): Observable<AggregatedHotspotsResult> {
    const criteria: HotspotCriteria = {
      metric: this.metric(),
      minScore: this.minScoreControl(),
      module: '',
    };

    this.loadingAggregated.set(true);
    return this.hotspotService.loadAggregated(criteria, this.limits()).pipe(
      tap(() => {
        this.loadingAggregated.set(false);
      }),
      catchError((err) => {
        this.loadingAggregated.set(false);
        this.showError(err);
        return of(initAggregatedHotspotsResult);
      })
    );
  }

  private loadHotspots(): Observable<HotspotResult> {
    const criteria: HotspotCriteria = {
      metric: this.metric(),
      minScore: this.minScoreControl(),
      module: this.selectedModule(),
    };

    this.loadingHotspots.set(true);

    return this.hotspotService.load(criteria, this.limits()).pipe(
      tap(() => {
        this.loadingHotspots.set(false);
      }),
      catchError((err) => {
        this.loadingHotspots.set(false);
        this.showError(err);
        return of(initHotspotResult);
      })
    );
  }
}

function trimSegments(fileName: string, prefix: string): string {
  if (fileName.startsWith(prefix)) {
    return fileName.substring(prefix.length + 1);
  }
  return fileName;
}