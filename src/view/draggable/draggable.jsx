// @flow
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import memoizeOne from 'memoize-one';
import invariant from 'invariant';
import type {
  Position,
  DraggableDimension,
  InitialDragPositions,
  DroppableId,
  AutoScrollMode,
} from '../../types';
import DraggableDimensionPublisher from '../draggable-dimension-publisher/';
import Moveable from '../moveable/';
import DragHandle from '../drag-handle';
import getViewport from '../window/get-viewport';
// eslint-disable-next-line no-duplicate-imports
import type {
  DragHandleProps,
  Callbacks as DragHandleCallbacks,
} from '../drag-handle/drag-handle-types';
import getCenterPosition from '../get-center-position';
import Placeholder from '../placeholder';
import { droppableIdKey, styleContextKey } from '../context-keys';
import type {
  Props,
  Provided,
  StateSnapshot,
  DefaultProps,
  DraggingStyle,
  NotDraggingStyle,
  DraggableStyle,
  ZIndexOptions,
} from './draggable-types';
import type { Speed, Style as MovementStyle } from '../moveable/moveable-types';

type State = {|
  ref: ?HTMLElement,
|}

export const zIndexOptions: ZIndexOptions = {
  dragging: 5000,
  dropAnimating: 4500,
};

export default class Draggable extends Component<Props, State> {
  /* eslint-disable react/sort-comp */
  callbacks: DragHandleCallbacks
  styleContext: string

  state: State = {
    ref: null,
  }

  static defaultProps: DefaultProps = {
    isDragDisabled: false,
    // cannot drag interactive elements by default
    disableInteractiveElementBlocking: false,
  }

  // Need to declare contextTypes without flow
  // https://github.com/brigand/babel-plugin-flow-react-proptypes/issues/22
  static contextTypes = {
    [droppableIdKey]: PropTypes.string.isRequired,
    [styleContextKey]: PropTypes.string.isRequired,
  }

  constructor(props: Props, context: Object) {
    super(props, context);

    const callbacks: DragHandleCallbacks = {
      onLift: this.onLift,
      onMove: this.onMove,
      onDrop: this.onDrop,
      onCancel: this.onCancel,
      onMoveBackward: this.onMoveBackward,
      onMoveForward: this.onMoveForward,
      onCrossAxisMoveForward: this.onCrossAxisMoveForward,
      onCrossAxisMoveBackward: this.onCrossAxisMoveBackward,
      onWindowScroll: this.onWindowScroll,
    };

    this.callbacks = callbacks;
    this.styleContext = context[styleContextKey];
  }

  // This should already be handled gracefully in DragHandle.
  // Just being extra clear here
  throwIfCannotDrag() {
    invariant(this.state.ref,
      'Draggable: cannot drag as no DOM node has been provided'
    );
    invariant(!this.props.isDragDisabled,
      'Draggable: cannot drag as dragging is not enabled'
    );
  }

  onMoveEnd = () => {
    if (!this.props.isDropAnimating) {
      return;
    }

    this.props.dropAnimationFinished();
  }

  onLift = (options: {client: Position, autoScrollMode: AutoScrollMode}) => {
    this.throwIfCannotDrag();
    const { client, autoScrollMode } = options;
    const { lift, draggableId } = this.props;
    const { ref } = this.state;

    if (!ref) {
      throw new Error('cannot lift at this time');
    }

    const initial: InitialDragPositions = {
      selection: client,
      center: getCenterPosition(ref),
    };

    lift(draggableId, initial, getViewport(), autoScrollMode);
  }

  onMove = (client: Position) => {
    this.throwIfCannotDrag();

    const { draggableId, dimension, move } = this.props;

    // dimensions not provided yet
    if (!dimension) {
      return;
    }

    move(draggableId, client, getViewport());
  }

  onMoveForward = () => {
    this.throwIfCannotDrag();
    this.props.moveForward(this.props.draggableId);
  }

  onMoveBackward = () => {
    this.throwIfCannotDrag();
    this.props.moveBackward(this.props.draggableId);
  }

  onCrossAxisMoveForward = () => {
    this.throwIfCannotDrag();
    this.props.crossAxisMoveForward(this.props.draggableId);
  }

  onCrossAxisMoveBackward = () => {
    this.throwIfCannotDrag();
    this.props.crossAxisMoveBackward(this.props.draggableId);
  }

  onWindowScroll = () => {
    this.throwIfCannotDrag();
    this.props.moveByWindowScroll(this.props.draggableId, getViewport());
  }

  onDrop = () => {
    this.throwIfCannotDrag();
    this.props.drop();
  }

  onCancel = () => {
    // Not checking if drag is enabled.
    // Cancel is an escape mechanism
    this.props.cancel();
  }

  // React calls ref callback twice for every render
  // https://github.com/facebook/react/pull/8333/files
  setRef = ((ref: ?HTMLElement) => {
    // TODO: need to clear this.state.ref on unmount
    if (ref === null) {
      return;
    }

    if (ref === this.state.ref) {
      return;
    }

    // need to trigger a child render when ref changes
    this.setState({
      ref,
    });
  })

  getDraggableRef = (): ?HTMLElement => this.state.ref;

  getPlaceholder() {
    const dimension: ?DraggableDimension = this.props.dimension;
    invariant(dimension, 'cannot get a drag placeholder when not dragging');

    return (
      <Placeholder placeholder={dimension.placeholder} />
    );
  }

  getDraggingStyle = memoizeOne(
    (dimension: DraggableDimension,
      isDropAnimating: boolean,
      movementStyle: MovementStyle): DraggingStyle => {
      const { width, height, top, left } = dimension.client.paddingBox;
      // For an explanation of properties see `draggable-types`.
      const style: DraggingStyle = {
        position: 'fixed',
        boxSizing: 'border-box',
        zIndex: isDropAnimating ? zIndexOptions.dropAnimating : zIndexOptions.dragging,
        width,
        height,
        top,
        left,
        margin: 0,
        pointerEvents: 'none',
        transition: 'none',
        transform: movementStyle.transform ? `${movementStyle.transform}` : null,
      };
      return style;
    }
  )

  getNotDraggingStyle = memoizeOne(
    (movementStyle: MovementStyle, shouldAnimateDisplacement: boolean): NotDraggingStyle => {
      const style: NotDraggingStyle = {
        transform: movementStyle.transform,
        // use the global animation for animation - or opt out of it
        transition: shouldAnimateDisplacement ? null : 'none',
        // transition: css.outOfTheWay,
      };
      return style;
    }
  )

  getProvided = memoizeOne(
    (
      isDragging: boolean,
      isDropAnimating: boolean,
      shouldAnimateDisplacement: boolean,
      dimension: ?DraggableDimension,
      dragHandleProps: ?DragHandleProps,
      movementStyle: MovementStyle,
    ): Provided => {
      const useDraggingStyle: boolean = isDragging || isDropAnimating;

      const draggableStyle: DraggableStyle = (() => {
        if (!useDraggingStyle) {
          return this.getNotDraggingStyle(movementStyle, shouldAnimateDisplacement);
        }

        invariant(dimension, 'draggable dimension required for dragging');

        // Need to position element in original visual position. To do this
        // we position it without
        return this.getDraggingStyle(dimension, isDropAnimating, movementStyle);
      })();

      const provided: Provided = {
        innerRef: this.setRef,
        draggableProps: {
          'data-react-beautiful-dnd-draggable': this.styleContext,
          style: draggableStyle,
        },
        dragHandleProps,
        placeholder: useDraggingStyle ? this.getPlaceholder() : null,
      };
      return provided;
    }
  )

  getSnapshot = memoizeOne((
    isDragging: boolean,
    isDropAnimating: boolean,
    draggingOver: ?DroppableId,
  ): StateSnapshot => ({
    isDragging: (isDragging || isDropAnimating),
    draggingOver,
  }))

  getSpeed = memoizeOne(
    (isDragging: boolean, shouldAnimateDragMovement: boolean, isDropAnimating: boolean): Speed => {
      if (isDropAnimating) {
        return 'STANDARD';
      }

      // if dragging and can animate - then move quickly
      if (isDragging && shouldAnimateDragMovement) {
        return 'FAST';
      }

      // Animation taken care of by css
      return 'INSTANT';
    })

  render() {
    const {
      draggableId,
      index,
      offset,
      isDragging,
      isDropAnimating,
      isDragDisabled,
      dimension,
      draggingOver,
      direction,
      shouldAnimateDragMovement,
      shouldAnimateDisplacement,
      disableInteractiveElementBlocking,
      children,
    } = this.props;
    const droppableId: DroppableId = this.context[droppableIdKey];

    const speed = this.getSpeed(
      isDragging,
      shouldAnimateDragMovement,
      isDropAnimating
    );

    return (
      <DraggableDimensionPublisher
        draggableId={draggableId}
        droppableId={droppableId}
        index={index}
        targetRef={this.state.ref}
      >
        <Moveable
          speed={speed}
          destination={offset}
          onMoveEnd={this.onMoveEnd}
        >
          {(movementStyle: MovementStyle) => (
            <DragHandle
              draggableId={draggableId}
              isDragging={isDragging}
              direction={direction}
              isEnabled={!isDragDisabled}
              callbacks={this.callbacks}
              getDraggableRef={this.getDraggableRef}
              // by default we do not allow dragging on interactive elements
              canDragInteractiveElements={disableInteractiveElementBlocking}
            >
              {(dragHandleProps: ?DragHandleProps) =>
                children(
                  this.getProvided(
                    isDragging,
                    isDropAnimating,
                    shouldAnimateDisplacement,
                    dimension,
                    dragHandleProps,
                    movementStyle,
                  ),
                  this.getSnapshot(
                    isDragging,
                    isDropAnimating,
                    draggingOver,
                  )
                )
              }
            </DragHandle>
          )}
        </Moveable>
      </DraggableDimensionPublisher>
    );
  }
}
