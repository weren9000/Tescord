const MAX_PROFILE_AVATAR_DIMENSION = 300;
const MAX_PROFILE_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;

export async function prepareProfileAvatarFile(file: File): Promise<File> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('Поддерживаются только PNG и JPG аватарки');
  }

  if (file.size > MAX_PROFILE_AVATAR_SOURCE_BYTES) {
    throw new Error('Исходное изображение слишком большое. Выберите файл до 8 МБ');
  }

  const image = await loadFileAsImage(file);
  if (image.width !== image.height) {
    throw new Error('Аватарка должна быть квадратной 1:1');
  }

  const targetSize = Math.min(MAX_PROFILE_AVATAR_DIMENSION, image.width, image.height);
  let preparedFile = file;

  if (image.width > MAX_PROFILE_AVATAR_DIMENSION || image.height > MAX_PROFILE_AVATAR_DIMENSION) {
    preparedFile = await resizeProfileAvatarFile(file, image, targetSize);
  }

  if (preparedFile.size > MAX_PROFILE_AVATAR_UPLOAD_BYTES) {
    throw new Error('Аватарка превышает лимит 2 МБ');
  }

  return preparedFile;
}

function loadFileAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Не удалось прочитать изображение'));
    };
    image.src = objectUrl;
  });
}

function resizeProfileAvatarFile(file: File, image: HTMLImageElement, targetSize: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;

    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Не удалось подготовить изображение'));
      return;
    }

    context.drawImage(image, 0, 0, targetSize, targetSize);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Не удалось сохранить изображение'));
          return;
        }

        resolve(
          new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now()
          })
        );
      },
      file.type,
      file.type === 'image/jpeg' ? 0.92 : undefined
    );
  });
}

export function normalizeClipboardAttachmentFile(file: File, index: number): File {
  if (file.name) {
    return file;
  }

  const extension = attachmentFileExtensionByMimeType(file.type);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return new File([file], `clipboard-${timestamp}-${index + 1}${extension}`, {
    type: file.type,
    lastModified: file.lastModified || Date.now()
  });
}

function attachmentFileExtensionByMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    default:
      return '';
  }
}

