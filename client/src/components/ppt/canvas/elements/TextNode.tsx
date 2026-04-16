import React, { useRef, useEffect, useState } from 'react';
import { Text, Rect, Group } from 'react-konva';
import type Konva from 'konva';
import type { TextElement } from '../../store/types';

interface TextNodeProps {
  element: TextElement;
  isSelected: boolean;
  onSelect: () => void;
  onTransformEnd: (newAttrs: Partial<TextElement>) => void;
  onTextChange?: (delta: { ops: { insert: string }[] }) => void;
}

function deltaToPlainText(delta: { ops: { insert: string }[] }): string {
  return delta.ops.map(op => op.insert).join('');
}

export function TextNode({ element, isSelected, onSelect, onTransformEnd }: TextNodeProps) {
  const textRef = useRef<Konva.Text>(null);
  const groupRef = useRef<Konva.Group>(null);
  const [textHeight, setTextHeight] = useState(element.h);

  const text = deltaToPlainText(element.delta);
  const style = element.defaultTextStyle;

  useEffect(() => {
    if (textRef.current) {
      const measuredHeight = textRef.current.height();
      if (measuredHeight !== textHeight) {
        setTextHeight(Math.max(element.h, measuredHeight));
      }
    }
  }, [text, style.fontSize, element.w, element.h, textHeight]);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onTransformEnd({
      x: e.target.x(),
      y: e.target.y()
    });
  };

  const handleTransformEnd = () => {
    const node = groupRef.current;
    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    onTransformEnd({
      x: node.x(),
      y: node.y(),
      w: Math.max(50, node.width() * scaleX),
      h: Math.max(20, node.height() * scaleY),
      rotation: node.rotation()
    });
  };

  return (
    <Group
      ref={groupRef}
      x={element.x}
      y={element.y}
      width={element.w}
      height={element.h}
      rotation={element.rotation ?? 0}
      draggable={!element.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
      opacity={element.opacity ?? 1}
    >
      {isSelected && (
        <Rect
          width={element.w}
          height={element.h}
          stroke="#2563eb"
          strokeWidth={1}
          dash={[4, 4]}
          fill="transparent"
        />
      )}
      <Text
        ref={textRef}
        text={text}
        width={element.w}
        height={element.h}
        fontSize={style.fontSize}
        fontFamily={style.fontFamily}
        fontStyle={[
          style.bold ? 'bold' : '',
          style.italic ? 'italic' : ''
        ].filter(Boolean).join(' ') || 'normal'}
        textDecoration={style.underline ? 'underline' : undefined}
        fill={style.color}
        wrap="word"
        verticalAlign="top"
      />
    </Group>
  );
}
