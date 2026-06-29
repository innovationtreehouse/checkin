import { isRegistrationDirty } from '../dirty';

const emptyParents = [{ name: '', email: '', phone: '' }];
const emptyEmergency = { name: '', phone: '' };
const emptyParticipants = [{ name: '', dob: '' }];

describe('isRegistrationDirty', () => {
  it('is false for the initial empty default', () => {
    expect(isRegistrationDirty(emptyParents, emptyEmergency, emptyParticipants)).toBe(false);
  });

  it('treats whitespace-only as not dirty', () => {
    expect(isRegistrationDirty([{ name: '   ', email: '', phone: '' }], emptyEmergency, emptyParticipants)).toBe(false);
  });

  it('is dirty when any parent field is filled', () => {
    expect(isRegistrationDirty([{ name: 'Jane', email: '', phone: '' }], emptyEmergency, emptyParticipants)).toBe(true);
  });

  it('is dirty when emergency contact is filled', () => {
    expect(isRegistrationDirty(emptyParents, { name: 'John', phone: '' }, emptyParticipants)).toBe(true);
  });

  it('is dirty when a participant field is filled', () => {
    expect(isRegistrationDirty(emptyParents, emptyEmergency, [{ name: 'Kid', dob: '' }])).toBe(true);
  });
});
