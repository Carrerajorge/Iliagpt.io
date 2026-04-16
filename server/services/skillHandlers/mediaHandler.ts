/**
 * Media Skill Handler
 *
 * Handles media generation requests: images, video, and audio/TTS.
 * Delegates to existing generation services for image and video,
 * and provides descriptive text for audio/TTS.
 */

import { generateImage } from '../imageGeneration';
import { generateVideo } from '../videoGeneration';
import { llmGateway } from '../../lib/llmGateway';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillHandlerResult {
  handled: boolean;
  skillId: string;
  skillName: string;
  category: string;
  artifacts: Array<{
    type: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
    size: number;
    metadata?: Record<string, unknown>;
  }>;
  textResponse: string;
  suggestions?: string[];
}

interface SkillHandlerRequest {
  message: string;
  userId: string;
  chatId: string;
  locale: string;
  attachments?: Array<{ name?: string; mimeType?: string; storagePath?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function errorResult(mediaType: string, errorMsg: string): SkillHandlerResult {
  return {
    handled: false,
    skillId: `media-${mediaType}`,
    skillName: `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} Generation`,
    category: 'media',
    artifacts: [],
    textResponse: `I was unable to generate the ${mediaType}. ${errorMsg}`,
  };
}

async function generateWithLLM(
  systemPrompt: string,
  userMessage: string,
  userId: string,
): Promise<string> {
  const response = await llmGateway.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { model: 'gpt-4o-mini', userId },
  );
  return response.content;
}

// ---------------------------------------------------------------------------
// Image handler
// ---------------------------------------------------------------------------

async function handleImageGeneration(
  request: SkillHandlerRequest,
): Promise<SkillHandlerResult> {
  // Refine the prompt with LLM for better generation results
  const refinedPrompt = await generateWithLLM(
    `You are an expert image prompt engineer. Based on the user's request, create an optimized, detailed image generation prompt. Include style, composition, lighting, and mood details. Respond ONLY with the refined prompt, no explanation.`,
    request.message,
    request.userId,
  );

  const result = await generateImage(refinedPrompt);

  if (result.error) {
    return errorResult('image', result.error);
  }

  const artifacts: SkillHandlerResult['artifacts'] = [];

  if (result.base64Data) {
    const buffer = Buffer.from(result.base64Data, 'base64');
    artifacts.push({
      type: 'image',
      filename: `image_${timestamp()}.png`,
      buffer,
      mimeType: 'image/png',
      size: buffer.length,
      metadata: {
        prompt: refinedPrompt.slice(0, 200),
        generatedAt: new Date().toISOString(),
      },
    });
  } else if (result.imageUrl) {
    // If we only get a URL, create a small text artifact with the URL
    const urlBuffer = Buffer.from(result.imageUrl, 'utf-8');
    artifacts.push({
      type: 'image-url',
      filename: `image_url_${timestamp()}.txt`,
      buffer: urlBuffer,
      mimeType: 'text/plain',
      size: urlBuffer.length,
      metadata: {
        imageUrl: result.imageUrl,
        prompt: refinedPrompt.slice(0, 200),
        generatedAt: new Date().toISOString(),
      },
    });
  }

  return {
    handled: true,
    skillId: 'media-image',
    skillName: 'Image Generation',
    category: 'media',
    artifacts,
    textResponse: result.imageUrl
      ? `Your image has been generated successfully.\n\n**Prompt used:** ${refinedPrompt.slice(0, 150)}${refinedPrompt.length > 150 ? '...' : ''}`
      : `Your image has been generated and is available as a downloadable file.\n\n**Prompt used:** ${refinedPrompt.slice(0, 150)}${refinedPrompt.length > 150 ? '...' : ''}`,
    suggestions: [
      'Generate a variation of this image',
      'Create this image in a different style',
      'Generate a higher resolution version',
      'Use this image in a presentation',
    ],
  };
}

// ---------------------------------------------------------------------------
// Video handler
// ---------------------------------------------------------------------------

async function handleVideoGeneration(
  request: SkillHandlerRequest,
): Promise<SkillHandlerResult> {
  // Refine the prompt for video generation
  const refinedPrompt = await generateWithLLM(
    `You are an expert video prompt engineer. Based on the user's request, create an optimized video generation prompt. Include motion, scene transitions, camera angles, and duration hints. Respond ONLY with the refined prompt, no explanation.`,
    request.message,
    request.userId,
  );

  const result = await generateVideo(refinedPrompt, {
    userId: request.userId,
    chatId: request.chatId,
  });

  const artifacts: SkillHandlerResult['artifacts'] = [];

  if (result.videoUrl) {
    const urlBuffer = Buffer.from(result.videoUrl, 'utf-8');
    artifacts.push({
      type: 'video-url',
      filename: `video_url_${timestamp()}.txt`,
      buffer: urlBuffer,
      mimeType: 'text/plain',
      size: urlBuffer.length,
      metadata: {
        videoUrl: result.videoUrl,
        prompt: refinedPrompt.slice(0, 200),
        generatedAt: new Date().toISOString(),
      },
    });
  }

  if (result.buffer) {
    artifacts.push({
      type: 'video',
      filename: `video_${timestamp()}.mp4`,
      buffer: result.buffer,
      mimeType: 'video/mp4',
      size: result.buffer.length,
      metadata: {
        prompt: refinedPrompt.slice(0, 200),
        generatedAt: new Date().toISOString(),
      },
    });
  }

  return {
    handled: true,
    skillId: 'media-video',
    skillName: 'Video Generation',
    category: 'media',
    artifacts,
    textResponse: `Your video has been generated successfully.\n\n**Prompt used:** ${refinedPrompt.slice(0, 150)}${refinedPrompt.length > 150 ? '...' : ''}`,
    suggestions: [
      'Generate a longer version',
      'Create a different angle or style',
      'Add text overlay to the video',
      'Extract a still frame from this video',
    ],
  };
}

// ---------------------------------------------------------------------------
// Audio/TTS handler
// ---------------------------------------------------------------------------

async function handleAudioGeneration(
  request: SkillHandlerRequest,
): Promise<SkillHandlerResult> {
  // Generate descriptive/script text via LLM for TTS
  const scriptContent = await generateWithLLM(
    `You are a professional scriptwriter and voice-over specialist. Based on the user's request, generate clear, well-paced text suitable for text-to-speech conversion. Include appropriate punctuation for natural pauses. If the user wants narration, write it in a professional narration style. Respond ONLY with the script text.`,
    request.message,
    request.userId,
  );

  // TTS requires an external service (e.g., sherpa-onnx-tts, OpenAI TTS).
  // We provide the script as a downloadable text artifact.
  const scriptBuffer = Buffer.from(scriptContent, 'utf-8');

  return {
    handled: true,
    skillId: 'media-audio',
    skillName: 'Audio/TTS Generation',
    category: 'media',
    artifacts: [
      {
        type: 'script',
        filename: `tts_script_${timestamp()}.txt`,
        buffer: scriptBuffer,
        mimeType: 'text/plain',
        size: scriptBuffer.length,
        metadata: {
          format: 'tts-script',
          charCount: scriptContent.length,
          generatedAt: new Date().toISOString(),
        },
      },
    ],
    textResponse: [
      '**TTS Script Generated**',
      '',
      'The following script has been prepared for text-to-speech conversion:',
      '',
      `> ${scriptContent.slice(0, 300)}${scriptContent.length > 300 ? '...' : ''}`,
      '',
      'Note: Audio synthesis requires an external TTS service (e.g., sherpa-onnx-tts or OpenAI TTS API). The full script is available as a downloadable file.',
    ].join('\n'),
    suggestions: [
      'Modify the script tone or style',
      'Make the script shorter/longer',
      'Generate an image to accompany this audio',
      'Create a presentation with this narration',
    ],
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleMedia(
  request: SkillHandlerRequest,
  mediaType: 'image' | 'video' | 'audio',
): Promise<SkillHandlerResult> {
  try {
    switch (mediaType) {
      case 'image':
        return await handleImageGeneration(request);
      case 'video':
        return await handleVideoGeneration(request);
      case 'audio':
        return await handleAudioGeneration(request);
      default:
        return errorResult(mediaType, `Unsupported media type: ${mediaType}. Supported: image, video, audio.`);
    }
  } catch (error: any) {
    console.warn('[SkillHandler:media]', error);
    return errorResult(mediaType, error?.message ?? 'An unexpected error occurred.');
  }
}
