import { QueueManager } from '../../src/queues/queue.manager';

describe('QueueManager Error Fallbacks (Unit)', () => {
  it('publish should catch error and return false if getChannel fails', async () => {
    jest.spyOn(QueueManager, 'getChannel').mockRejectedValueOnce(new Error('Channel error'));
    const result = await QueueManager.publish('test-q', { data: 1 });
    expect(result).toBe(false);
  });
});
