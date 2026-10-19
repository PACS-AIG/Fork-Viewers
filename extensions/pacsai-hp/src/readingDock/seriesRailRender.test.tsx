/**
 * Rev 11 milestone 6, approach C, phase 1 PR 4: the series rail as ui-next draws
 * it (the 'rail' preset of StudyItem, ThumbnailList and Thumbnail), the stock
 * presets untouched, and measurement-tracking's panel module offering the rail.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
// From source, not the package index (which loads every component, one of them
// past babel's regenerator transform).
import { StudyItem } from '../../../../platform/ui-next/src/components/StudyItem/StudyItem';
import { TooltipProvider } from '../../../../platform/ui-next/src/components/Tooltip/Tooltip';

let mockPanelProps: Record<string, unknown> | null = null;
jest.mock('../../../measurement-tracking/src/panels', () => ({
  PanelStudyBrowserTracking: (props: Record<string, unknown>) => {
    mockPanelProps = props;
    return null;
  },
  PanelMeasurementTableTracking: () => null,
}));
// eslint-disable-next-line import/first
import getPanelModule from '../../../measurement-tracking/src/getPanelModule';

const displaySets = [
  {
    displaySetInstanceUID: 'ds-sr',
    componentType: 'thumbnailNoImage',
    seriesNumber: 900,
    numInstances: 1,
    description: 'Dose report',
    modality: 'SR',
  },
  {
    displaySetInstanceUID: 'ds-2',
    componentType: 'thumbnail',
    seriesNumber: 2,
    numInstances: 120,
    description: 'Ax 5mm soft tissue',
    modality: 'CT',
    imageSrc: 'data:image/png;base64,AAAA',
    dragData: { type: 'displayset', displaySetInstanceUID: 'ds-2' },
  },
  {
    displaySetInstanceUID: 'ds-3',
    componentType: 'thumbnail',
    seriesNumber: 3,
    numInstances: 64,
    description: 'Cor reformat',
    modality: 'CT',
    dragData: { type: 'displayset', displaySetInstanceUID: 'ds-3' },
  },
];

const study = (props: Record<string, unknown>) =>
  render(
    <DndProvider backend={HTML5Backend}>
      <TooltipProvider>
        <StudyItem
          date="05-Oct-2026"
          description="CT CHEST ABDOMEN PELVIS W CONTRAST"
          numInstances={185}
          modalities={'CT\\SR'}
          onClick={() => {}}
          studyRole="current"
          StudyInstanceUID="1.2.3"
          {...props}
        />
      </TooltipProvider>
    </DndProvider>
  );

describe('the series rail (ui-next rail preset)', () => {
  it('a study is one compact row: the date, then its role dot and modalities', () => {
    const { container } = study({ viewPreset: 'rail', isExpanded: false });
    const row = container.querySelector('[data-rail-study]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toBe('05-Oct-2026CT\\SR');
    // the date has its line to itself; the dot leads the second
    expect((row.firstElementChild as HTMLElement).textContent).toBe('05-Oct-2026');
    expect(row.querySelector('span.rounded-full')).not.toBeNull();
    // the description and the image count are the tooltip's, not the row's
    expect(row.textContent).not.toContain('CT CHEST ABDOMEN PELVIS');
    expect(row.textContent).not.toContain('185');
  });

  it('an opened study is one narrow column of tiles in series-number order, each with its number, count and description; no-image series too', () => {
    const onDoubleClickThumbnail = jest.fn();
    const { container } = study({
      viewPreset: 'rail',
      isExpanded: true,
      displaySets,
      activeDisplaySetInstanceUIDs: ['ds-3'],
      onClickThumbnail: () => {},
      onDoubleClickThumbnail,
      onClickUntrack: () => {},
    });
    const list = container.querySelector('[data-cy="series-rail-list"]') as HTMLElement;
    expect(list).not.toBeNull();
    const tiles = Array.from(list.querySelectorAll('[data-rail-tile]'));
    expect(tiles).toHaveLength(3);
    const text = (i: number, attr: string) =>
      (tiles[i].querySelector(`[data-${attr}]`) as HTMLElement).textContent;
    expect(text(0, 'rail-series')).toBe('S:2');
    expect(text(0, 'rail-count')).toBe('120');
    expect(text(0, 'rail-description')).toBe('Ax 5mm soft tissue');
    expect(tiles[0].querySelector('img')).not.toBeNull();
    // the active viewport's series is marked
    expect(tiles[1].className).toContain('bg-popover');
    expect(tiles[0].className).not.toContain('bg-popover');
    // a series with no image is a tile showing its modality
    expect(text(2, 'rail-series')).toBe('S:900');
    expect(tiles[2].textContent).toContain('SR');
    // the stock grid and list are not drawn: every thumbnail is a rail tile
    const thumbs = Array.from(container.querySelectorAll('[data-cy^="study-browser-thumbnail"]'));
    expect(thumbs).toHaveLength(3);
    expect(thumbs.every(t => t.querySelector('[data-rail-tile]'))).toBe(true);
    fireEvent.doubleClick(tiles[0]);
    expect(onDoubleClickThumbnail).toHaveBeenCalledWith('ds-2', expect.anything());
  });

  it('the stock thumbnails preset is untouched: no rail row, no rail tiles', () => {
    const { container } = study({
      viewPreset: 'thumbnails',
      isExpanded: true,
      displaySets,
      onClickThumbnail: () => {},
      onDoubleClickThumbnail: () => {},
      onClickUntrack: () => {},
    });
    expect(container.querySelector('[data-rail-study]')).toBeNull();
    expect(container.querySelector('[data-rail-tile]')).toBeNull();
    expect(container.querySelector('[data-cy="series-rail-list"]')).toBeNull();
    expect(container.textContent).toContain('CT CHEST ABDOMEN PELVIS');
  });

  it("measurement-tracking's panel module offers the rail: the same study browser, presentation 'rail'", () => {
    const panels = getPanelModule({
      commandsManager: {},
      extensionManager: {},
      servicesManager: {},
    } as never);
    expect(panels.map(p => p.name)).toEqual(['seriesList', 'seriesRail', 'trackedMeasurements']);
    const rail = panels.find(p => p.name === 'seriesRail') as {
      label: string;
      component: (p: object) => JSX.Element;
    };
    expect(rail.label).toBe('Series');
    render(rail.component({}));
    expect(mockPanelProps?.presentation).toBe('rail');
    const stock = panels.find(p => p.name === 'seriesList') as {
      component: (p: object) => JSX.Element;
    };
    render(stock.component({}));
    expect(mockPanelProps?.presentation).toBeUndefined();
  });
});
