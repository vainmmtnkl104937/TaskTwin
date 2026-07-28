import './popup.css';

type RecorderStatus = 'Idle';

const recorderStatus: RecorderStatus = 'Idle';
const statusElement = document.querySelector<HTMLElement>('[data-status]');

if (statusElement === null) {
  throw new Error('Recorder status element is missing.');
}

statusElement.textContent = recorderStatus;
