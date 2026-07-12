import type { AIModelProfile } from "@/types";

export class ModelProfileRegistry {
  private readonly profiles = new Map<string, AIModelProfile>();

  constructor(profiles: AIModelProfile[] = []) {
    profiles.forEach((profile) => this.register(profile));
  }

  register(profile: AIModelProfile): void {
    this.profiles.set(profile.id, profile);
  }

  get(profileId: string): AIModelProfile | undefined {
    return this.profiles.get(profileId) ?? [...this.profiles.values()].find((profile) => profile.profileId === profileId);
  }

  require(profileId: string): AIModelProfile {
    const profile = this.get(profileId);
    if (!profile) throw new Error(`Model profile not found: ${profileId}`);
    return profile;
  }

  list(): AIModelProfile[] {
    return [...this.profiles.values()];
  }
}
