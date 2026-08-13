import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny'

export class Mp4Recorder {
  private output:any = null
  private videoSource:MediaStreamVideoTrackSource | null = null
  private audioSource:MediaStreamAudioTrackSource | null = null

  async start(canvas:HTMLCanvasElement, audioTrack:MediaStreamTrack, fps=30) {
    const canvasStream = canvas.captureStream(fps)
    const videoTrack = canvasStream.getVideoTracks()[0]

    const target = new BufferTarget()
    const output = new Output({
      format: new Mp4OutputFormat(),
      target,
    })

    const videoSource = new MediaStreamVideoTrackSource(videoTrack, {
      codec: 'avc',
      quality: new Quality('high'),
    }, { frameRate: fps, timestampBase: 'synced-zero' })

    const typedAudioTrack = audioTrack as ConstructorParameters<typeof MediaStreamAudioTrackSource>[0]
    const audioSource = new MediaStreamAudioTrackSource(typedAudioTrack, {
      codec: 'aac',
      // Use a predictable stereo-music bitrate, but keep the MediaStream's
      // native sample rate/channel layout instead of forcing a resample/remix.
      quality: new Quality({ bitrate: 192e3 }),
    }, { timestampBase: 'synced-zero' })

    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)

    this.output = output
    this.videoSource = videoSource
    this.audioSource = audioSource
    await output.start()
  }

  async stop() {
    if (!this.output) throw new Error('Recorder was not started.')
    this.videoSource?.close()
    this.audioSource?.close()
    await this.output.finalize()

    const buffer = this.output.target.buffer
    if (!buffer) throw new Error('No MP4 buffer produced.')

    const blob = new Blob([buffer], {type:'video/mp4'})
    this.output = null
    this.videoSource = null
    this.audioSource = null
    return blob
  }
}

/**
 * Create a new trimmed MP4 entirely in the browser.
 * The source recording is AVC/AAC MP4 produced by this app. We force a
 * transcode so the requested in/out points do not depend on source keyframes.
 */
export async function trimMp4(
  blob:Blob,
  start:number,
  end:number,
  onProgress?:(progress:number)=>void
) {
  if (!(end > start)) throw new Error('Trim end must be after trim start.')

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob),
  })

  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  })

  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start, end },
      video: {
        codec: 'avc',
        quality: new Quality('high'),
        forceTranscode: true,
      },
      audio: {
        codec: 'aac',
        quality: new Quality('high'),
        forceTranscode: true,
      },
    })

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map(d=>d.reason).join(', ')
      throw new Error(`This browser cannot create the trimmed MP4${reasons ? ` (${reasons})` : ''}.`)
    }

    conversion.onProgress = (p:number) => onProgress?.(p)
    await conversion.execute()

    const buffer = output.target.buffer
    if (!buffer) throw new Error('Trim export produced no output.')
    return new Blob([buffer], {type:'video/mp4'})
  } finally {
    try { input.dispose() } catch {}
  }
}

export function downloadBlob(blob:Blob, filename:string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(()=>URL.revokeObjectURL(url), 3000)
}
