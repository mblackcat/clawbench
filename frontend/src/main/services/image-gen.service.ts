import * as logger from '../utils/logger'
import type { ToolDefinition, ToolResult } from './tool-executor.service'
import { getImageGenConfigs } from '../store/settings.store'

export interface ImageGenConfig {
  id: string
  name: string
  provider: 'dall-e' | 'stable-diffusion' | 'custom'
  endpoint: string
  apiKey: string
  defaultModel?: string
  defaultSize?: string
  enabled: boolean
}

/**
 * Built-in text-to-image tool
 */
export const IMAGE_GENERATION_TOOL: ToolDefinition = {
  name: 'generate_image',
  description:
    'Generate an image from a text description using AI image generation (e.g. DALL-E, Stable Diffusion). Returns the image as a base64-encoded string.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'A detailed text description of the image to generate',
      },
      size: {
        type: 'string',
        description: 'Image size (e.g. "1024x1024", "1024x1792", "1792x1024")',
        default: '1024x1024',
      },
      style: {
        type: 'string',
        description: 'Image style: "vivid" for hyper-real/dramatic, "natural" for more natural look',
        enum: ['vivid', 'natural'],
      },
      quality: {
        type: 'string',
        description: 'Image quality: "standard" or "hd"',
        enum: ['standard', 'hd'],
      },
    },
    required: ['prompt'],
  },
  source: 'builtin',
}

/**
 * Built-in image edit (image-to-image) tool
 */
export const IMAGE_EDIT_TOOL: ToolDefinition = {
  name: 'edit_image',
  description:
    'Edit or transform an existing image based on a text description. The image should be referenced by its file path or URL.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'A description of what to change or how to edit the image',
      },
      imagePath: {
        type: 'string',
        description: 'File path of the source image to edit',
      },
      size: {
        type: 'string',
        description: 'Output image size (e.g. "1024x1024")',
        default: '1024x1024',
      },
    },
    required: ['prompt', 'imagePath'],
  },
  source: 'builtin',
}

function getActiveConfig(): ImageGenConfig | null {
  const configs = getImageGenConfigs()
  return configs.find((c) => c.enabled) ?? null
}

/**
 * Generate image via DALL-E API (OpenAI-compatible)
 */
async function generateDallE(
  config: ImageGenConfig,
  prompt: string,
  size?: string,
  style?: string,
  quality?: string
): Promise<ToolResult> {
  const model = config.defaultModel || 'dall-e-3'
  const body: Record<string, any> = {
    model,
    prompt,
    n: 1,
    size: size || config.defaultSize || '1024x1024',
    response_format: 'b64_json',
  }
  if (style) body.style = style
  if (quality) body.quality = quality

  const endpoint = config.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${endpoint}/v1/images/generations`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`API error ${response.status}: ${errText}`)
  }

  const result = await response.json()
  const imageData = result.data?.[0]
  if (!imageData) throw new Error('No image data in response')

  const b64 = imageData.b64_json
  const revisedPrompt = imageData.revised_prompt || ''

  return {
    output: JSON.stringify({
      type: 'image',
      format: 'png',
      base64: b64,
      revisedPrompt,
    }),
    isError: false,
  }
}

/**
 * Generate image via Stable Diffusion API (A1111 / compatible)
 */
async function generateStableDiffusion(
  config: ImageGenConfig,
  prompt: string,
  size?: string
): Promise<ToolResult> {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const [width, height] = (size || config.defaultSize || '1024x1024').split('x').map(Number)

  const body: Record<string, any> = {
    prompt,
    width: width || 1024,
    height: height || 1024,
    steps: 30,
  }

  const url = `${endpoint}/sdapi/v1/txt2img`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`API error ${response.status}: ${errText}`)
  }

  const result = await response.json()
  const b64 = result.images?.[0]
  if (!b64) throw new Error('No image data in response')

  return {
    output: JSON.stringify({
      type: 'image',
      format: 'png',
      base64: b64,
    }),
    isError: false,
  }
}

/**
 * Generic custom endpoint (expects OpenAI-compatible response)
 */
async function generateCustom(
  config: ImageGenConfig,
  prompt: string,
  size?: string,
  style?: string,
  quality?: string
): Promise<ToolResult> {
  return generateDallE(config, prompt, size, style, quality)
}

/**
 * Execute the generate_image tool
 */
export async function executeImageGeneration(
  input: Record<string, any>
): Promise<ToolResult> {
  const config = getActiveConfig()
  if (!config) {
    return {
      error: '未配置图片生成服务。请前往设置 → 图片生成进行配置。',
      isError: true,
    }
  }

  const { prompt, size, style, quality } = input
  if (!prompt) {
    return { error: 'Missing required parameter: prompt', isError: true }
  }

  logger.info(`Generating image: provider=${config.provider}, prompt="${prompt.substring(0, 80)}..."`)

  try {
    switch (config.provider) {
      case 'dall-e':
        return await generateDallE(config, prompt, size, style, quality)
      case 'stable-diffusion':
        return await generateStableDiffusion(config, prompt, size)
      case 'custom':
        return await generateCustom(config, prompt, size, style, quality)
      default:
        return { error: `Unknown provider: ${config.provider}`, isError: true }
    }
  } catch (err: any) {
    logger.error('Image generation failed', err)
    return {
      error: `图片生成失败: ${err.message || '未知错误'}`,
      isError: true,
    }
  }
}

/**
 * Execute the edit_image tool
 */
export async function executeImageEdit(
  input: Record<string, any>
): Promise<ToolResult> {
  const config = getActiveConfig()
  if (!config) {
    return {
      error: '未配置图片生成服务。请前往设置 → 图片生成进行配置。',
      isError: true,
    }
  }

  const { prompt, imagePath, size } = input
  if (!prompt || !imagePath) {
    return { error: 'Missing required parameters: prompt, imagePath', isError: true }
  }

  // Read the source image
  const fs = await import('fs')
  const path = await import('path')
  if (!fs.existsSync(imagePath)) {
    return { error: `Image file not found: ${imagePath}`, isError: true }
  }

  logger.info(`Editing image: ${imagePath}, prompt="${prompt.substring(0, 80)}..."`)

  try {
    if (config.provider === 'dall-e' || config.provider === 'custom') {
      // DALL-E edit endpoint
      const endpoint = config.endpoint.replace(/\/+$/, '').replace(/\/v1$/, '')
      const url = `${endpoint}/v1/images/edits`
      const imageBuffer = fs.readFileSync(imagePath)
      const ext = path.extname(imagePath).toLowerCase()
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg'

      const formData = new FormData()
      formData.append('image', new Blob([imageBuffer], { type: mimeType }), path.basename(imagePath))
      formData.append('prompt', prompt)
      formData.append('n', '1')
      formData.append('size', size || config.defaultSize || '1024x1024')
      formData.append('response_format', 'b64_json')
      if (config.defaultModel) formData.append('model', config.defaultModel)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: formData,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`API error ${response.status}: ${errText}`)
      }

      const result = await response.json()
      const b64 = result.data?.[0]?.b64_json
      if (!b64) throw new Error('No image data in response')

      return {
        output: JSON.stringify({
          type: 'image',
          format: 'png',
          base64: b64,
        }),
        isError: false,
      }
    } else if (config.provider === 'stable-diffusion') {
      // img2img endpoint
      const endpoint = config.endpoint.replace(/\/+$/, '')
      const url = `${endpoint}/sdapi/v1/img2img`
      const imageBuffer = fs.readFileSync(imagePath)
      const b64Image = imageBuffer.toString('base64')
      const [width, height] = (size || config.defaultSize || '1024x1024').split('x').map(Number)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          init_images: [b64Image],
          prompt,
          width: width || 1024,
          height: height || 1024,
          steps: 30,
          denoising_strength: 0.75,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`API error ${response.status}: ${errText}`)
      }

      const result = await response.json()
      const b64 = result.images?.[0]
      if (!b64) throw new Error('No image data in response')

      return {
        output: JSON.stringify({
          type: 'image',
          format: 'png',
          base64: b64,
        }),
        isError: false,
      }
    }

    return { error: `Provider ${config.provider} does not support image editing`, isError: true }
  } catch (err: any) {
    logger.error('Image edit failed', err)
    return {
      error: `图片编辑失败: ${err.message || '未知错误'}`,
      isError: true,
    }
  }
}
