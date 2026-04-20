export function isIphoneLikeBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /iPhone|iPod/i.test(navigator.userAgent);
}

export async function requestCameraStream(preferredConstraints: MediaTrackConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Браузер не поддерживает доступ к камере');
  }

  const attempts: MediaStreamConstraints[] = [
    {
      video: preferredConstraints,
      audio: false,
    },
    {
      video: {
        facingMode: 'user',
      },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];

  let lastError: unknown = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Не удалось получить видеопоток камеры');
}

export function prepareInlineMediaElement(element: HTMLMediaElement): void {
  element.autoplay = true;
  element.preload = 'auto';
  element.setAttribute('autoplay', '');
  element.setAttribute('playsinline', 'true');
  element.setAttribute('webkit-playsinline', 'true');

  const videoElement = element as HTMLVideoElement & { playsInline?: boolean };
  if ('playsInline' in videoElement) {
    videoElement.playsInline = true;
  }
}
