import React, { useState } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { useDrag } from 'react-dnd';
import { Icons } from '../Icons';
import { DisplaySetMessageListTooltip } from '../DisplaySetMessageListTooltip';
import { TooltipTrigger, TooltipContent, Tooltip } from '../Tooltip';
import { useHoverScrub } from './useHoverScrub';

/**
 * Display a thumbnail for a display set.
 */
const Thumbnail = ({
  displaySetInstanceUID,
  className,
  imageSrc,
  imageAltText,
  description,
  seriesNumber,
  numInstances,
  loadingProgress,
  countIcon,
  messages,
  isActive,
  onClick,
  onDoubleClick,
  thumbnailType,
  modality,
  sliceThickness,
  scrub,
  viewPreset = 'thumbnails',
  isHydratedForDerivedDisplaySet = false,
  isTracked = false,
  canReject = false,
  dragData = {},
  onReject = () => {},
  onClickUntrack = () => {},
  ThumbnailMenuItems = () => {},
}: withAppTypes): React.ReactNode => {
  // TODO: We should wrap our thumbnail to create a "DraggableThumbnail", as
  // this will still allow for "drag", even if there is no drop target for the
  // specified item.
  const [collectedProps, drag, dragPreview] = useDrag({
    type: 'displayset',
    item: { ...dragData },
    canDrag: function (monitor) {
      return Object.keys(dragData).length !== 0;
    },
  });

  const [lastTap, setLastTap] = useState(0);

  // Hover-scrub (PACS AI): sweep the series by moving the mouse across the image.
  // Thumbnail-local only — never drives a viewport (see useHoverScrub).
  const { scrubDisplay, onScrubMove, onScrubLeave } = useHoverScrub(scrub);

  const handleTouchEnd = e => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 300 && tapLength > 0) {
      onDoubleClick(e);
    } else {
      onClick(e);
    }
    setLastTap(currentTime);
  };

  const renderThumbnailPreset = () => {
    return (
      <div
        className={classnames(
          'flex h-full w-full flex-col items-center justify-center gap-[2px] p-[4px]',
          isActive && 'bg-popover'
        )}
      >
        <div className="h-[114px] w-[128px]">
          <div
            className="relative"
            onMouseMove={scrub ? onScrubMove : undefined}
            onMouseLeave={scrub ? onScrubLeave : undefined}
          >
            {imageSrc || scrubDisplay ? (
              <img
                src={scrubDisplay?.src ?? imageSrc}
                alt={imageAltText}
                className="h-[114px] w-[128px] rounded"
                crossOrigin="anonymous"
              />
            ) : (
              <div className="bg-background h-[114px] w-[128px] rounded"></div>
            )}

            {/* hover-scrub position badge */}
            {scrubDisplay && (
              <div className="absolute top-0 left-0 rounded-br bg-black/60 px-[4px] py-[1px] text-[10px] leading-4 text-white">
                {scrubDisplay.index + 1}/{scrubDisplay.count}
              </div>
            )}

            {/* bottom left */}
            <div className="absolute bottom-0 left-0 flex h-[14px] items-center gap-[4px] rounded-tr pt-[10px] pb-[8px] pr-[6px] pl-[3px]">
              <div
                className={classnames(
                  'h-[10px] w-[10px] rounded-[2px]',
                  isActive || isHydratedForDerivedDisplaySet ? 'bg-highlight' : 'bg-primary/65',
                  loadingProgress && loadingProgress < 1 && 'bg-primary/25'
                )}
              ></div>
              <div className="text-[11px] font-semibold text-white">{modality}</div>
            </div>

            {/* top right */}
            <div className="absolute top-0 right-0 flex items-center gap-[4px]">
              <DisplaySetMessageListTooltip
                messages={messages}
                id={`display-set-tooltip-${displaySetInstanceUID}`}
              />
              {isTracked && (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="group">
                      <Icons.StatusTracking className="text-primary-light h-[15px] w-[15px] group-hover:hidden" />
                      <Icons.Cancel
                        className="text-primary-light hidden h-[15px] w-[15px] group-hover:block"
                        onClick={onClickUntrack}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <div className="flex flex-1 flex-row">
                      <div className="flex-2 flex items-center justify-center pr-4">
                        <Icons.InfoLink className="text-primary-active" />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <span>
                          <span className="text-white">
                            {isTracked ? 'Series is tracked' : 'Series is untracked'}
                          </span>
                        </span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {/* bottom right */}
            <div className="absolute bottom-0 right-0 flex items-center gap-[4px] p-[4px]">
              <ThumbnailMenuItems
                displaySetInstanceUID={displaySetInstanceUID}
                canReject={canReject}
                onReject={onReject}
              />
            </div>
          </div>
        </div>
        <div className="flex h-[52px] w-[128px] flex-col justify-end">
          <Tooltip>
            <TooltipContent>{description}</TooltipContent>
            <TooltipTrigger>
              <div className="min-h-[18px] w-[128px] overflow-hidden text-ellipsis whitespace-nowrap pb-0.5 pl-1 text-left text-[12px] font-normal leading-4 text-white">
                {description}
              </div>
            </TooltipTrigger>
          </Tooltip>
          <div className="flex h-[12px] items-center gap-[7px] overflow-hidden">
            <div className="text-muted-foreground pl-1 text-[11px]"> S:{seriesNumber}</div>
            <div className="text-muted-foreground text-[11px]">
              <div className="flex items-center gap-[4px]">
                {countIcon ? (
                  React.createElement(Icons[countIcon] || Icons.MissingIcon, { className: 'w-3' })
                ) : (
                  <Icons.InfoSeries className="w-3" />
                )}
                <div>{numInstances}</div>
              </div>
            </div>
            {sliceThickness ? (
              <div className="text-muted-foreground text-[11px]">{sliceThickness}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  // pacsai (Rev 11 milestone 6, approach C, phase 1 PR 4): radcopilot's series
  // rail. A narrow tile: the image (96 × 72) with the series number, the modality
  // and the image count on it, the description on one line under it, and the
  // whole of it on hover. Drag and double-click are the thumbnail's own.
  const renderRailPreset = () => {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={classnames(
              'flex h-full w-full flex-col items-center gap-[2px] p-[2px]',
              isActive && 'bg-popover'
            )}
            data-rail-tile=""
          >
            <div
              className="relative h-[72px] w-[96px]"
              onMouseMove={scrub ? onScrubMove : undefined}
              onMouseLeave={scrub ? onScrubLeave : undefined}
            >
              {imageSrc || scrubDisplay ? (
                <img
                  src={scrubDisplay?.src ?? imageSrc}
                  alt={imageAltText}
                  className="h-[72px] w-[96px] rounded object-cover"
                  crossOrigin="anonymous"
                />
              ) : (
                // A series without an image shows its modality; an image series
                // still loading stays blank (its modality is on the badge below).
                <div className="bg-background text-muted-foreground flex h-[72px] w-[96px] items-center justify-center rounded text-[12px]">
                  {thumbnailType === 'thumbnailNoImage' ? modality : null}
                </div>
              )}
              <div
                className="absolute top-0 left-0 rounded-br bg-black/60 px-[3px] text-[10px] leading-4 text-white"
                data-rail-series=""
              >
                S:{seriesNumber}
              </div>
              <div className="absolute top-0 right-0 flex items-center gap-[2px]">
                <DisplaySetMessageListTooltip
                  messages={messages}
                  id={`display-set-tooltip-${displaySetInstanceUID}`}
                />
                {isTracked && (
                  <Icons.StatusTracking className="text-primary-light h-[13px] w-[13px]" />
                )}
                <ThumbnailMenuItems
                  displaySetInstanceUID={displaySetInstanceUID}
                  canReject={canReject}
                  onReject={onReject}
                />
              </div>
              <div className="absolute bottom-0 left-0 flex items-center gap-[3px] rounded-tr bg-black/60 px-[3px] py-[1px]">
                <div
                  className={classnames(
                    'h-[8px] w-[8px] rounded-[2px]',
                    isActive || isHydratedForDerivedDisplaySet ? 'bg-highlight' : 'bg-primary/65',
                    loadingProgress && loadingProgress < 1 && 'bg-primary/25'
                  )}
                ></div>
                <div className="text-[10px] font-semibold leading-3 text-white">{modality}</div>
              </div>
              <div
                className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-[3px] text-[10px] leading-4 text-white"
                data-rail-count=""
              >
                {numInstances}
              </div>
            </div>
            <div
              className="w-[96px] overflow-hidden text-ellipsis whitespace-nowrap text-left text-[11px] leading-4 text-white"
              data-rail-description=""
            >
              {description}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <div className="max-w-[260px]">
            <div>{description}</div>
            <div className="text-muted-foreground text-[11px]">
              S:{seriesNumber} · {numInstances} {numInstances === 1 ? 'image' : 'images'}
              {modality ? ` · ${modality}` : ''}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderListPreset = () => {
    return (
      <div
        className={classnames(
          'flex h-full w-full items-center justify-between pr-[8px] pl-[8px] pt-[4px] pb-[4px]',
          isActive && 'bg-popover'
        )}
      >
        <div className="relative flex h-[32px] w-full items-center gap-[8px] overflow-hidden">
          <div
            className={classnames(
              'h-[32px] w-[4px] min-w-[4px] rounded-[2px]',
              isActive || isHydratedForDerivedDisplaySet ? 'bg-highlight' : 'bg-primary/65',
              loadingProgress && loadingProgress < 1 && 'bg-primary/25'
            )}
          ></div>
          <div className="flex h-full w-[calc(100%-12px)] flex-col">
            <div className="flex items-center gap-[7px]">
              <div className="text-[13px] font-semibold text-white">{modality}</div>
              <Tooltip>
                <TooltipContent>{description}</TooltipContent>
                <TooltipTrigger className="w-full overflow-hidden">
                  <div className="max-w-[160px] overflow-hidden overflow-ellipsis whitespace-nowrap text-left text-[13px] font-normal text-white">
                    {description}
                  </div>
                </TooltipTrigger>
              </Tooltip>
            </div>

            <div className="flex h-[12px] items-center gap-[7px] overflow-hidden">
              <div className="text-muted-foreground text-[12px]"> S:{seriesNumber}</div>
              <div className="text-muted-foreground text-[12px]">
                <div className="flex items-center gap-[4px]">
                  {' '}
                  {countIcon ? (
                    React.createElement(Icons[countIcon] || Icons.MissingIcon, { className: 'w-3' })
                  ) : (
                    <Icons.InfoSeries className="w-3" />
                  )}
                  <div>{numInstances}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex h-full items-center gap-[4px]">
          <DisplaySetMessageListTooltip
            messages={messages}
            id={`display-set-tooltip-${displaySetInstanceUID}`}
          />
          {isTracked && (
            <Tooltip>
              <TooltipTrigger>
                <div className="group">
                  <Icons.StatusTracking className="text-primary-light h-[20px] w-[15px] group-hover:hidden" />
                  <Icons.Cancel
                    className="text-primary-light hidden h-[15px] w-[15px] group-hover:block"
                    onClick={onClickUntrack}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="flex flex-1 flex-row">
                  <div className="flex-2 flex items-center justify-center pr-4">
                    <Icons.InfoLink className="text-primary-active" />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <span>
                      <span className="text-white">
                        {isTracked ? 'Series is tracked' : 'Series is untracked'}
                      </span>
                    </span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          <ThumbnailMenuItems
            displaySetInstanceUID={displaySetInstanceUID}
            canReject={canReject}
            onReject={onReject}
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className={classnames(
        className,
        'bg-muted hover:bg-primary/30 group flex cursor-pointer select-none flex-col rounded outline-none',
        viewPreset === 'thumbnails' && 'h-[170px] w-[135px]',
        viewPreset === 'list' && 'h-[40px] w-full',
        viewPreset === 'rail' && 'w-[100px]'
      )}
      id={`thumbnail-${displaySetInstanceUID}`}
      data-cy={
        thumbnailType === 'thumbnailNoImage'
          ? 'study-browser-thumbnail-no-image'
          : 'study-browser-thumbnail'
      }
      data-series={seriesNumber}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onTouchEnd={handleTouchEnd}
      role="button"
    >
      <div
        ref={drag}
        className="h-full w-full"
      >
        {viewPreset === 'thumbnails' && renderThumbnailPreset()}
        {viewPreset === 'list' && renderListPreset()}
        {viewPreset === 'rail' && renderRailPreset()}
      </div>
    </div>
  );
};

Thumbnail.propTypes = {
  displaySetInstanceUID: PropTypes.string.isRequired,
  className: PropTypes.string,
  imageSrc: PropTypes.string,
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
  imageAltText: PropTypes.string,
  description: PropTypes.string.isRequired,
  seriesNumber: PropTypes.any,
  numInstances: PropTypes.number.isRequired,
  loadingProgress: PropTypes.number,
  messages: PropTypes.object,
  isActive: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  onDoubleClick: PropTypes.func.isRequired,
  viewPreset: PropTypes.string,
  modality: PropTypes.string,
  sliceThickness: PropTypes.string,
  /** Optional hover-scrub source ({ getImageIds, getImageSrc }) — see useHoverScrub. */
  scrub: PropTypes.shape({
    getImageIds: PropTypes.func.isRequired,
    getImageSrc: PropTypes.func.isRequired,
  }),
  isHydratedForDerivedDisplaySet: PropTypes.bool,
  isTracked: PropTypes.bool,
  onClickUntrack: PropTypes.func,
  countIcon: PropTypes.string,
  thumbnailType: PropTypes.oneOf(['thumbnail', 'thumbnailTracked', 'thumbnailNoImage']),
};

export { Thumbnail };
