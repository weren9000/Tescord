import { CallEncryption } from './call-encryption';

describe('automatic call key exchange', () => {
  const grant = {
    protocol: 'olm-livekit-v1',
    token: 'isolated-unit-test',
    room: 'local-test-room',
    identity: 'owner',
  };

  it('keeps an early envelope until LiveKit has announced its sender', async () => {
    const session = new CallEncryption(grant, jasmine.createSpy('fail'));
    session['snapshot'] = {
      devices: [{ identity: 'joining', id: 'joining-device', device_keys: { keys: {} } }],
      envelopes: [{ sequence: 1, sender_id: 'joining-device', ciphertext: {} }],
      one_time_key_counts: {},
    };
    const request = jasmine.createSpy('request').and.resolveTo(undefined);
    session['request'] = request;
    await session['receive']();
    expect(request).not.toHaveBeenCalled();
    expect(session['seen'].size).toBe(0);
  });

  it('retains a known sender key for a roster announced later, without decrypting it twice', async () => {
    const session = new CallEncryption(grant, jasmine.createSpy('fail'));
    const nextRoster = 'b'.repeat(64);
    const peer = {
      identity: 'peer',
      id: 'peer-device',
      device_keys: {
        keys: { 'curve25519:peer-device': 'sender-key' },
      },
    };
    class Event {
      encryptionInfo = {
        isSenderVerified: () => true,
        senderCurve25519Key: 'sender-key',
      };
      rawEvent = JSON.stringify({
        type: 'ru.kvachat.media-key',
        content: {
          room: grant.room,
          roster: nextRoster,
          generation: 2,
          key: btoa('\0'.repeat(32)),
        },
      });
      free = jasmine.createSpy('free');
    }
    const decrypt = jasmine.createSpy('decrypt').and.resolveTo([new Event()]);
    const install = jasmine.createSpy('install').and.resolveTo(undefined);
    session['room'] = {
      remoteParticipants: new Map([['peer', {}]]),
    } as unknown as (typeof session)['room'];
    session['module'] = {
      DecryptedToDeviceEvent: Event,
      DeviceLists: class {},
    } as unknown as (typeof session)['module'];
    session['machine'] = {
      receiveSyncChangesMsc4186: decrypt,
    } as unknown as (typeof session)['machine'];
    session['provider'] = { install } as unknown as (typeof session)['provider'];
    session['snapshot'] = {
      devices: [peer],
      envelopes: [{ sequence: 7, sender_id: peer.id, ciphertext: {} }],
      one_time_key_counts: {},
    };
    session['request'] = jasmine.createSpy('request').and.resolveTo(undefined);
    session['roster'] = session['approved'] = 'a'.repeat(64);
    await session['receive']();
    expect(install).not.toHaveBeenCalled();
    expect(session['incoming'].size).toBe(1);
    session['roster'] = session['approved'] = nextRoster;
    await session['receive']();
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(session['received'].get(peer.id)).toBe(2);
    expect(session['incoming'].size).toBe(0);
    // A replay in a different envelope must not reinstall an already used generation.
    session['snapshot'].envelopes[0].sequence = 8;
    session['received'].clear();
    await session['receive']();
    expect(install).toHaveBeenCalledTimes(1);
    expect(session['received'].size).toBe(0);
  });

  for (const change of ['membership', 'close']) {
    it(`does not approve a stale roster after ${change} during asynchronous trust`, async () => {
      const session = new CallEncryption(grant, jasmine.createSpy('fail'));
      let finishTrust!: () => void;
      const trusted = new Promise<void>((resolve) => (finishTrust = resolve));
      const device = {
        setLocalTrust: jasmine.createSpy('setLocalTrust').and.returnValue(trusted),
        free: jasmine.createSpy('free'),
      };
      session['snapshot'].devices = [
        { identity: 'owner', id: 'another-device', device_keys: { keys: {} } },
      ];
      session['module'] = {
        UserId: class {},
        DeviceId: class {},
        LocalTrust: { Verified: 0 },
      } as unknown as (typeof session)['module'];
      session['machine'] = {
        getDevice: async () => device,
      } as unknown as (typeof session)['machine'];
      const current = () => !session['stopped'] && session['membershipEpoch'] === 0;
      const approval = session['approveDevices']('roster', current);
      await Promise.resolve();
      expect(device.setLocalTrust).toHaveBeenCalled();
      if (change === 'membership') session['membershipEpoch']++;
      else session['stopped'] = true;
      finishTrust();
      await approval;
      expect(session['approved']).toBe('');
      expect(device.free).toHaveBeenCalled();
    });
  }
});
