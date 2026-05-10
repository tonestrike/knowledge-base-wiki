export interface Correction {
  readonly replacementText: string;
  readonly newCitationLabel?: string;
}

export const Correction = {
  create(props: { replacementText: string; newCitationLabel?: string }): Correction {
    if (!props.replacementText || props.replacementText.length > 2000) {
      throw new Error('Correction.replacementText must be 1..2000 chars');
    }
    if (props.newCitationLabel !== undefined && props.newCitationLabel.length > 200) {
      throw new Error('Correction.newCitationLabel must be ≤200 chars');
    }
    return Object.freeze({ ...props });
  },
};
