import React, { useRef, useEffect, useState } from 'react';
import { Image, Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { ChartElement } from '../../store/types';

interface ChartNodeProps {
  element: ChartElement;
  isSelected: boolean;
  onSelect: () => void;
  onTransformEnd: (newAttrs: Partial<ChartElement>) => void;
}

export function ChartNode({ element, isSelected, onSelect, onTransformEnd }: ChartNodeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (element.svg) {
      const svgBlob = new Blob([element.svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new window.Image();
      img.onload = () => {
        setImage(img);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } else if (element.src) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setImage(img);
      img.src = element.src;
    }
  }, [element.svg, element.src]);

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
      h: Math.max(50, node.height() * scaleY),
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
      {image ? (
        <Image
          image={image}
          width={element.w}
          height={element.h}
        />
      ) : (
        <>
          <Rect
            width={element.w}
            height={element.h}
            fill="#f3f4f6"
            stroke="#d1d5db"
            strokeWidth={1}
          />
          <Text
            text="Chart"
            width={element.w}
            height={element.h}
            align="center"
            verticalAlign="middle"
            fontSize={16}
            fill="#9ca3af"
          />
        </>
      )}
      {isSelected && (
        <Rect
          width={element.w}
          height={element.h}
          stroke="#2563eb"
          strokeWidth={2}
          fill="transparent"
        />
      )}
    </Group>
  );
}
