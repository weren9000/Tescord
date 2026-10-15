const container = document.getElementById('sources');
window.capturePicker.sources().then(sources => {
  for (const source of sources) {
    const button = document.createElement('button');
    const thumbnail = document.createElement('img');
    thumbnail.src = source.thumbnail; thumbnail.alt = '';
    const label = document.createElement('span'); label.textContent = source.name;
    button.append(thumbnail, label); button.title = source.name;
    button.onclick = () => window.capturePicker.choose(source.id, document.getElementById('audio').checked);
    container.append(button);
  }
  if (!sources.length) container.textContent = 'Нет доступных экранов и окон.';
}).catch(() => { container.textContent = 'Не удалось получить список экранов. Закройте окно и попробуйте снова.'; });
document.getElementById('cancel').onclick = () => window.capturePicker.cancel();
