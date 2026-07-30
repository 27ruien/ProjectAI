import {
  createAudioTranscriptionProvider,
  type AudioTaskStatus,
  type AudioTranscriptionProvider,
  type SpeakerDiarizationProvider,
} from "./audio-provider";

export const AUDIO_TRANSCRIPTION_MODEL_PROFILE_ID =
  "qwen-meeting-transcription-cn-v1";
export const AUDIO_TRANSCRIPTION_SKILL_ID =
  "workflow.meeting_minutes.transcription";

type TrustedAudioProvider = AudioTranscriptionProvider &
  SpeakerDiarizationProvider;

export type AudioTranscriptionRuntime = {
  modelProfileId: typeof AUDIO_TRANSCRIPTION_MODEL_PROFILE_ID;
  provider: TrustedAudioProvider["provider"];
  actualModel: string;
  diarizationProvider: TrustedAudioProvider["diarizationProvider"];
  diarizationModel: string;
  providesSpeakerIds: true;
};

/** Provider-neutral server boundary for every asynchronous ASR operation. */
export class AudioTranscriptionGateway {
  readonly runtime: AudioTranscriptionRuntime;

  constructor(private readonly provider: TrustedAudioProvider) {
    this.runtime = {
      modelProfileId: AUDIO_TRANSCRIPTION_MODEL_PROFILE_ID,
      provider: provider.provider,
      actualModel: provider.model,
      diarizationProvider: provider.diarizationProvider,
      diarizationModel: provider.diarizationModel,
      providesSpeakerIds: provider.providesSpeakerIds,
    };
  }

  submit(fileUrl: string): Promise<{ taskId: string }> {
    return this.provider.submit(fileUrl);
  }

  poll(taskId: string): Promise<AudioTaskStatus> {
    return this.provider.poll(taskId);
  }
}

export function createAudioTranscriptionGateway(): AudioTranscriptionGateway {
  return new AudioTranscriptionGateway(createAudioTranscriptionProvider());
}
