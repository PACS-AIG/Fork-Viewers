import React from 'react';
import PropTypes from 'prop-types';

import { Thumbnail } from '../Thumbnail';

const ThumbnailList = ({
  thumbnails,
  onThumbnailClick,
  onThumbnailDoubleClick,
  onClickUntrack,
  activeDisplaySetInstanceUIDs = [],
  viewPreset,
  ThumbnailMenuItems,
}) => {
  // pacsai (phase 1 PR 4): the series rail is one narrow column of rail tiles,
  // display sets without an image included (their tile shows the modality), in
  // series-number order (here, not by sorting the display sets for everyone, as
  // the stock browser's sort setting does), series without a number last.
  const seriesOrder = ({ seriesNumber }) => {
    const n = seriesNumber === '' || seriesNumber == null ? NaN : Number(seriesNumber);
    return Number.isFinite(n) ? n : Infinity;
  };
  const railItems =
    viewPreset === 'rail'
      ? [...(thumbnails ?? [])].sort((a, b) => seriesOrder(a) - seriesOrder(b))
      : [];

  // Filter thumbnails into list items and thumbnail items
  const listItems = thumbnails?.filter(
    ({ componentType }) =>
      viewPreset !== 'rail' && (componentType === 'thumbnailNoImage' || viewPreset === 'list')
  );

  const thumbnailItems = thumbnails?.filter(
    ({ componentType }) => componentType !== 'thumbnailNoImage' && viewPreset === 'thumbnails'
  );

  return (
    <div className="flex flex-col gap-[4px] pt-[4px] pr-[2.5px] pl-[5px] pb-[4px]">
      {/* Rail Items */}
      {railItems.length > 0 && (
        <div
          id="ohif-thumbnail-list"
          className="bg-bkg-low flex flex-col items-center gap-[4px]"
          data-cy="series-rail-list"
        >
          {railItems.map(item => {
            const { displaySetInstanceUID, componentType, numInstances, ...rest } = item;
            const isActive = activeDisplaySetInstanceUIDs.includes(displaySetInstanceUID);
            return (
              <Thumbnail
                key={displaySetInstanceUID}
                {...rest}
                displaySetInstanceUID={displaySetInstanceUID}
                numInstances={numInstances || 1}
                isActive={isActive}
                thumbnailType={componentType}
                viewPreset="rail"
                onClick={onThumbnailClick.bind(null, displaySetInstanceUID)}
                onDoubleClick={onThumbnailDoubleClick.bind(null, displaySetInstanceUID)}
                onClickUntrack={onClickUntrack.bind(null, displaySetInstanceUID)}
                ThumbnailMenuItems={ThumbnailMenuItems}
              />
            );
          })}
        </div>
      )}
      {/* Thumbnail Items */}
      {thumbnailItems.length > 0 && (
        <div
          id="ohif-thumbnail-list"
          className="ohif-scrollbar bg-bkg-low grid grid-cols-[repeat(auto-fit,_minmax(0,135px))] place-items-start gap-[4px] overflow-y-hidden"
        >
          {thumbnailItems.map(item => {
            const { displaySetInstanceUID, componentType, numInstances, ...rest } = item;

            const isActive = activeDisplaySetInstanceUIDs.includes(displaySetInstanceUID);
            return (
              <Thumbnail
                key={displaySetInstanceUID}
                {...rest}
                displaySetInstanceUID={displaySetInstanceUID}
                numInstances={numInstances || 1}
                isActive={isActive}
                thumbnailType={componentType}
                viewPreset="thumbnails"
                onClick={onThumbnailClick.bind(null, displaySetInstanceUID)}
                onDoubleClick={onThumbnailDoubleClick.bind(null, displaySetInstanceUID)}
                onClickUntrack={onClickUntrack.bind(null, displaySetInstanceUID)}
                ThumbnailMenuItems={ThumbnailMenuItems}
              />
            );
          })}
        </div>
      )}
      {/* List Items */}
      {listItems.length > 0 && (
        <div
          id="ohif-thumbnail-list"
          className="ohif-scrollbar bg-bkg-low grid grid-cols-[repeat(auto-fit,_minmax(0,275px))] place-items-start gap-[2px] overflow-y-hidden"
        >
          {listItems.map(item => {
            const { displaySetInstanceUID, componentType, numInstances, ...rest } = item;
            const isActive = activeDisplaySetInstanceUIDs.includes(displaySetInstanceUID);
            return (
              <Thumbnail
                key={displaySetInstanceUID}
                {...rest}
                displaySetInstanceUID={displaySetInstanceUID}
                numInstances={numInstances || 1}
                isActive={isActive}
                thumbnailType={componentType}
                viewPreset="list"
                onClick={onThumbnailClick.bind(null, displaySetInstanceUID)}
                onDoubleClick={onThumbnailDoubleClick.bind(null, displaySetInstanceUID)}
                onClickUntrack={onClickUntrack.bind(null, displaySetInstanceUID)}
                ThumbnailMenuItems={ThumbnailMenuItems}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

ThumbnailList.propTypes = {
  thumbnails: PropTypes.arrayOf(
    PropTypes.shape({
      displaySetInstanceUID: PropTypes.string.isRequired,
      imageSrc: PropTypes.string,
      imageAltText: PropTypes.string,
      seriesDate: PropTypes.string,
      seriesNumber: PropTypes.any,
      numInstances: PropTypes.number,
      description: PropTypes.string,
      componentType: PropTypes.any,
      isTracked: PropTypes.bool,
      /**
       * Data the thumbnail should expose to a receiving drop target. Use a matching
       * `dragData.type` to identify which targets can receive this draggable item.
       * If this is not set, drag-n-drop will be disabled for this thumbnail.
       *
       * Ref: https://react-dnd.github.io/react-dnd/docs/api/use-drag#specification-object-members
       */
      dragData: PropTypes.shape({
        /** Must match the "type" a dropTarget expects */
        type: PropTypes.string.isRequired,
      }),
    })
  ),
  activeDisplaySetInstanceUIDs: PropTypes.arrayOf(PropTypes.string),
  onThumbnailClick: PropTypes.func.isRequired,
  onThumbnailDoubleClick: PropTypes.func.isRequired,
  onClickUntrack: PropTypes.func.isRequired,
  viewPreset: PropTypes.string,
  ThumbnailMenuItems: PropTypes.any,
};

export { ThumbnailList };
