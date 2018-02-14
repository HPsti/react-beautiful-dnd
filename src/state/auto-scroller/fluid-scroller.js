// @flow
import rafSchd from 'raf-schd';
import memoizeOne from 'memoize-one';
import getViewport from '../../window/get-viewport';
import { add, apply, isEqual } from '../position';
import isTooBigToAutoScroll from './is-too-big-to-auto-scroll';
import getBestScrollableDroppable from './get-best-scrollable-droppable';
import { horizontal, vertical } from '../axis';
import {
  canScrollDroppable,
  canScrollWindow,
  canScrollDroppableWithPlaceholder,
} from './can-scroll';
import type {
  Area,
  Axis,
  Spacing,
  DroppableId,
  DragState,
  DroppableDimension,
  Position,
  State,
  DraggableDimension,
  ClosestScrollable,
  DroppableDimensionViewport,
} from '../../types';

// Values used to control how the fluid auto scroll feels
export const config = {
  // percentage distance from edge of container:
  startFrom: 0.25,
  maxSpeedAt: 0.05,
  // pixels per frame
  maxScrollSpeed: 28,
  // A function used to ease the distance been the startFrom and maxSpeedAt values
  // A simple linear function would be: (percentage) => percentage;
  // percentage is between 0 and 1
  // result must be between 0 and 1
  ease: (percentage: number) => Math.pow(percentage, 2),
};

const origin: Position = { x: 0, y: 0 };

// will replace -0 and replace with +0
const clean = apply((value: number) => (value === 0 ? 0 : value));

export type PixelThresholds = {|
  startFrom: number,
  maxSpeedAt: number,
  accelerationPlane: number,
|}

// converts the percentages in the config into actual pixel values
export const getPixelThresholds = (container: Area, axis: Axis): PixelThresholds => {
  const startFrom: number = container[axis.size] * config.startFrom;
  const maxSpeedAt: number = container[axis.size] * config.maxSpeedAt;
  const accelerationPlane: number = startFrom - maxSpeedAt;

  const thresholds: PixelThresholds = {
    startFrom,
    maxSpeedAt,
    accelerationPlane,
  };

  return thresholds;
};

const getSpeed = (distance: number, thresholds: PixelThresholds): number => {
  // Not close enough to the edge
  if (distance >= thresholds.startFrom) {
    return 0;
  }

  // Already past the maxSpeedAt point

  if (distance <= thresholds.maxSpeedAt) {
    return config.maxScrollSpeed;
  }

  // We need to perform a scroll as a percentage of the max scroll speed

  const distancePastStart: number = thresholds.startFrom - distance;
  const percentage: number = distancePastStart / thresholds.accelerationPlane;
  const transformed: number = config.ease(percentage);

  const speed: number = config.maxScrollSpeed * transformed;

  return speed;
};

// returns null if no scroll is required
const getRequiredScroll = (container: Area, center: Position): ?Position => {
  // get distance to each edge
  const distance: Spacing = {
    top: center.y - container.top,
    right: container.right - center.x,
    bottom: container.bottom - center.y,
    left: center.x - container.left,
  };

  // 1. Figure out which x,y values are the best target
  // 2. Can the container scroll in that direction at all?
  // If no for both directions, then return null
  // 3. Is the center close enough to a edge to start a drag?
  // 4. Based on the distance, calculate the speed at which a scroll should occur
  // The lower distance value the faster the scroll should be.
  // Maximum speed value should be hit before the distance is 0
  // Negative values to not continue to increase the speed

  const y: number = (() => {
    const thresholds: PixelThresholds = getPixelThresholds(container, vertical);
    const isCloserToBottom: boolean = distance.bottom < distance.top;

    if (isCloserToBottom) {
      return getSpeed(distance.bottom, thresholds);
    }

    // closer to top
    return -1 * getSpeed(distance.top, thresholds);
  })();

  const x: number = (() => {
    const thresholds: PixelThresholds = getPixelThresholds(container, horizontal);
    const isCloserToRight: boolean = distance.right < distance.left;

    if (isCloserToRight) {
      return getSpeed(distance.right, thresholds);
    }

    // closer to left
    return -1 * getSpeed(distance.left, thresholds);
  })();

  const required: Position = clean({ x, y });

  return isEqual(required, origin) ? null : required;
};

const withPlaceholder = (
  droppable: DroppableDimension,
  draggable: DraggableDimension,
): DroppableDimension => {
  const isOverHome: boolean = droppable.descriptor.id === draggable.descriptor.droppableId;

  // only need to add the buffer for foreign lists
  if (isOverHome) {
    return droppable;
  }

  const closest: ?ClosestScrollable = droppable.viewport.closestScrollable;

  // not scrollable
  if (!closest) {
    return droppable;
  }

  const placeholder: Position = {
    x: draggable.placeholder.withoutMargin.width,
    y: draggable.placeholder.withoutMargin.height,
  };

  const max: Position = add(closest.scroll.max, placeholder);
  const current: Position = {
    x: Math.min(closest.scroll.current.x, max.x),
    y: Math.min(closest.scroll.current.y, max.y),
  };

  const withBuffer: ClosestScrollable = {
    frame: closest.frame,
    shouldClipSubject: closest.shouldClipSubject,
    scroll: {
      initial: closest.scroll.initial,
      current,
      max,
      diff: closest.scroll.diff,
    },
  };

  const viewport: DroppableDimensionViewport = {
    closestScrollable: withBuffer,
    subject: droppable.viewport.subject,
    clipped: droppable.viewport.clipped,
  };

  // $ExpectError - using spread
  const modified: DroppableDimension = {
    ...droppable,
    viewport,
  };

  return modified;
};

type Api = {|
  scrollWindow: (offset: Position) => void,
  scrollDroppable: (id: DroppableId, offset: Position) => void,
|}

type ResultFn = (state: State) => void;
type ResultCancel = { cancel: () => void };

export type FluidScroller = ResultFn & ResultCancel;

export default ({
  scrollWindow,
  scrollDroppable,
}: Api): FluidScroller => {
  const scheduleWindowScroll = rafSchd(scrollWindow);
  const scheduleDroppableScroll = rafSchd(scrollDroppable);

  const result = (state: State): void => {
    const drag: ?DragState = state.drag;
    if (!drag) {
      console.error('Invalid drag state');
      return;
    }

    const center: Position = drag.current.page.center;

    // 1. Can we scroll the viewport?

    const draggable: DraggableDimension = state.dimension.draggable[drag.initial.descriptor.id];
    const viewport: Area = getViewport();

    if (isTooBigToAutoScroll(viewport, draggable.page.withMargin)) {
      return;
    }

    const requiredWindowScroll: ?Position = getRequiredScroll(viewport, center);

    if (requiredWindowScroll && canScrollWindow(requiredWindowScroll)) {
      scheduleWindowScroll(requiredWindowScroll);
      return;
    }

    // 2. We are not scrolling the window. Can we scroll a Droppable?

    const droppable: ?DroppableDimension = getBestScrollableDroppable({
      center,
      destination: drag.impact.destination,
      droppables: state.dimension.droppable,
    });

    // No scrollable targets
    if (!droppable) {
      return;
    }

    // We know this has a closestScrollable
    const closestScrollable: ClosestScrollable = (droppable.viewport.closestScrollable : any);

    if (isTooBigToAutoScroll(closestScrollable.frame, draggable.page.withMargin)) {
      return;
    }

    const requiredFrameScroll: ?Position = getRequiredScroll(closestScrollable.frame, center);
    const extended: DroppableDimension = withPlaceholder(droppable, draggable);

    if (requiredFrameScroll && canScrollDroppable(extended, requiredFrameScroll)) {
      scheduleDroppableScroll(droppable.descriptor.id, requiredFrameScroll);
    }
  };

  result.cancel = () => {
    scheduleWindowScroll.cancel();
    scheduleDroppableScroll.cancel();
  };

  return result;
};

