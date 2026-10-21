/**
 * 22 Oct: the reading window's header at 200 % zoom (960 CSS px). Its mark,
 * its reading controls and the patient line overran the row, and the page
 * scrolled sideways by a few px, more as the line's image count grew.
 * radcopilot now lets the patient line give way (ViewerLayout's
 * `headerPatientInfoShrinks`, to ui-next Header's `patientInfoShrinks` and the
 * chip's `shrinks`): its zone may shrink, the chip below its 380 px cap, its
 * lines cut, its title carrying them whole. Unset (every other mode), the
 * header is as it was. jsdom lays nothing out, so these pin the classes and
 * the title; the radcopilot probe's a11y arm measures the row in a browser.
 */
import React from 'react';
import { render } from '@testing-library/react';

// ui-next's index loads every component (one of them past babel's regenerator
// transform): the Header's few imports from it, stood in.
jest.mock('../../../../platform/ui-next/src/components', () => {
  const { createElement } = jest.requireActual('react');
  const pass = ({ children }: { children?: unknown }) => createElement('div', null, children);
  const none = () => null;
  return {
    DropdownMenu: pass,
    DropdownMenuTrigger: pass,
    DropdownMenuContent: pass,
    DropdownMenuItem: pass,
    Button: pass,
    Icons: { ArrowLeft: none, OHIFLogo: none, GearSettings: none, ByName: none },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@ohif/ui-next', () => ({
  Icons: { Patient: () => null, MultiplePatients: () => null },
}));
jest.mock('@ohif/core', () => ({
  utils: {
    formatPN: (name: string) => name,
    formatDate: (date: string) => date,
    parseDicomAge: (age?: string) => (age ? '61Y' : undefined),
    deriveAgeFromDob: () => undefined,
  },
}));

// eslint-disable-next-line import/first
import Header from '../../../../platform/ui-next/src/components/Header/Header';
// eslint-disable-next-line import/first
import HeaderPatientInfo from '../../../default/src/ViewerLayout/HeaderPatientInfo/HeaderPatientInfo';

const servicesManager = (instance: Record<string, string>) => ({
  services: {
    displaySetService: {
      getActiveDisplaySets: () => [
        {
          StudyInstanceUID: 'study-1',
          numImageFrames: 1497,
          instances: [{ PatientID: 'p1', ...instance }],
        },
      ],
      subscribe: () => ({ unsubscribe: () => undefined }),
      EVENTS: { DISPLAY_SETS_ADDED: 'added' },
    },
    hangingProtocolService: {
      getState: () => ({ activeStudyUID: 'study-1' }),
      subscribe: () => ({ unsubscribe: () => undefined }),
      EVENTS: { PROTOCOL_CHANGED: 'changed' },
    },
    panelService: { activatePanel: jest.fn() },
  },
});
// Synthetic: no real patient.
const PATIENT = {
  PatientName: 'DOE^JANE',
  PatientAge: '061Y',
  PatientSex: 'F',
  AccessionNumber: '12345',
  StudyDescription: 'CT Abdomen/Pelvis',
  StudyDate: '20260629',
};
const chipOf = (container: HTMLElement) =>
  container.querySelector('[data-cy="header-study-chip"]') as HTMLElement;
const classesOf = (el: Element) => el.className.split(/\s+/);

describe("the header's patient line, in a row too narrow for it (radcopilot at 200 % zoom)", () => {
  it("radcopilot's header lets the patient line's zone shrink; every other mode's keeps it whole", () => {
    const chip = <div data-cy="header-study-chip">chip</div>;
    const zoneOf = (container: HTMLElement) => chipOf(container).parentElement as HTMLElement;
    const stock = render(
      <Header
        menuOptions={[]}
        PatientInfo={chip}
      />
    );
    // As before the change, to the class string.
    expect(zoneOf(stock.container).className).toBe('flex shrink-0 select-none items-center');
    stock.unmount();
    const reading = render(
      <Header
        menuOptions={[]}
        PatientInfo={chip}
        patientInfoShrinks
      />
    );
    expect(classesOf(zoneOf(reading.container))).toContain('min-w-0');
    expect(classesOf(zoneOf(reading.container))).not.toContain('shrink-0');
    // The gear stays whole beside it.
    expect(classesOf(zoneOf(reading.container).lastElementChild as Element)).toContain(
      'flex-shrink-0'
    );
  });

  it('with `shrinks`, the chip gives way below its cap, and its title carries both lines whole', () => {
    const { container } = render(
      <HeaderPatientInfo
        servicesManager={servicesManager(PATIENT) as never}
        appConfig={{}}
        shrinks
      />
    );
    const chip = chipOf(container);
    expect(classesOf(chip)).toContain('max-w-[380px]');
    expect(chip.style.minWidth).toBe('0');
    const lines = [...chip.querySelectorAll('.truncate')].map(l => l.textContent);
    expect(lines).toEqual([
      'DOE^JANE · 61Y F · Acc 12345',
      'CT Abdomen/Pelvis · 20260629 · 1497 images',
    ]);
    expect(chip.getAttribute('title')).toBe(`${lines[0]}\n${lines[1]}\nOpen Study Info`);
  });

  it("without it (every other mode), the chip is as before: capped, and titled 'Open Study Info'", () => {
    const { container } = render(
      <HeaderPatientInfo
        servicesManager={servicesManager(PATIENT) as never}
        appConfig={{}}
      />
    );
    const chip = chipOf(container);
    expect(chip.className).toBe(
      'hover:bg-primary-dark flex max-w-[380px] cursor-pointer items-center gap-2 rounded-lg px-2 py-0.5'
    );
    expect(chip.getAttribute('style')).toBeNull();
    expect(chip.getAttribute('title')).toBe('Open Study Info');
  });

  it('a study with no patient details: the line says so, and so does the title', () => {
    const { container } = render(
      <HeaderPatientInfo
        servicesManager={servicesManager({ StudyDescription: 'CT Head' }) as never}
        appConfig={{}}
        shrinks
      />
    );
    const chip = chipOf(container);
    expect(chip.querySelector('.truncate')?.textContent).toBe('Patient details unavailable');
    expect(chip.getAttribute('title')).toBe(
      'Patient details unavailable\nCT Head · 1497 images\nOpen Study Info'
    );
    const stock = render(
      <HeaderPatientInfo
        servicesManager={servicesManager({ StudyDescription: 'CT Head' }) as never}
        appConfig={{}}
      />
    );
    expect(chipOf(stock.container).querySelector('.truncate')?.textContent).toBe(
      'Patient details unavailable'
    );
  });
});
