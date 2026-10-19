import React, { useEffect, useState } from 'react';
import { DicomMetadataStore, utils } from '@ohif/core';
import { useViewportGrid } from '@ohif/ui-next';
import { Button, Icons } from '@ohif/ui-next';
import { PanelMeasurement, StudySummaryFromMetadata } from '@ohif/extension-cornerstone';
import { useTrackedMeasurements } from '../getContextModule';
import { trackingPromptsOff } from '../contexts/TrackedMeasurementsContext/trackingPrompts';

const { filterAnd, filterPlanarMeasurement, filterMeasurementsBySeriesUID } =
  utils.MeasurementFilters;

function PanelMeasurementTableTracking({
  servicesManager,
  extensionManager,
  commandsManager,
}: withAppTypes) {
  const [viewportGrid] = useViewportGrid();
  const { customizationService } = servicesManager.services;
  const [trackedMeasurements, sendTrackedMeasurementsEvent] = useTrackedMeasurements();
  const { trackedStudy, trackedSeries } = trackedMeasurements.context;
  const measurementFilter = trackedStudy
    ? filterAnd(filterPlanarMeasurement, filterMeasurementsBySeriesUID(trackedSeries))
    : filterPlanarMeasurement;

  const disableEditing = customizationService.getCustomization('panelMeasurement.disableEditing');

  return (
    <>
      <StudySummaryFromMetadata StudyInstanceUID={trackedStudy} />
      <PanelMeasurement
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        commandsManager={commandsManager}
        measurementFilter={measurementFilter}
        customHeader={({ additionalFindings, measurements }) => {
          const disabled = additionalFindings.length === 0 && measurements.length === 0;

          if (disableEditing || disabled) {
            return null;
          }
          // pacsai (Rev 11 M6 approach C, phase 1 PR 2): no SR save where the
          // active mode has the tracking prompts off (read here, at render:
          // the mode sets it after this panel may have mounted).
          const saveOffered = !trackingPromptsOff(customizationService);

          return (
            <div className="bg-background flex h-9 w-full items-center rounded pr-0.5">
              <div className="flex space-x-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="pl-1.5"
                  onClick={() => {
                    commandsManager.runCommand('downloadCSVMeasurementsReport', {
                      measurementFilter,
                    });
                  }}
                >
                  <Icons.Download className="h-5 w-5" />
                  <span className="pl-1">CSV</span>
                </Button>
                {saveOffered && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="pl-0.5"
                    onClick={() => {
                      sendTrackedMeasurementsEvent('SAVE_REPORT', {
                        viewportId: viewportGrid.activeViewportId,
                        isBackupSave: true,
                      });
                    }}
                  >
                    <Icons.Add />
                    Create SR
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="pl-0.5"
                  onClick={() => {
                    commandsManager.runCommand('clearMeasurements', { measurementFilter });
                  }}
                >
                  <Icons.Delete />
                  Delete All
                </Button>
              </div>
            </div>
          );
        }}
      ></PanelMeasurement>
    </>
  );
}

export default PanelMeasurementTableTracking;
