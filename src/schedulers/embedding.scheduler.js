import cron from 'node-cron';
import { getDirtyThreads, getThreadMessages, upsertThreadEmbedding, deleteThreadEmbedding, getUsersByIds } from '../repositories/message.repository.js';
import { buildThreadContent, generateEmbedding } from '../services/embedding.service.js';

export function startEmbeddingScheduler() {
    console.log('⏰ Embedding scheduler started — runs every 5 minutes');

    cron.schedule('*/5 * * * *', async () => {
        console.log('🔄 Embedding scheduler tick — checking dirty threads...');

        try {
            const dirtyThreads = await getDirtyThreads();

            if (dirtyThreads.length === 0) {
                console.log('✅ No dirty threads found — nothing to embed');
                return;
            }

            console.log(`📋 Found ${dirtyThreads.length} dirty thread(s) to embed`);

            for (const thread of dirtyThreads) {
                try {
                    const messages = await getThreadMessages(
                        thread.workspace_id,
                        thread.channel_id,
                        thread.thread_ts
                    );

                    if (messages.length === 0) {
                        console.log(`⚠️ Thread ${thread.thread_ts} has no messages — deleting row`);
                        await deleteThreadEmbedding(thread.workspace_id, thread.channel_id, thread.thread_ts);
                        continue;
                    }
                    
                    // Resolve all unique users in this thread from cache
                    const userIds = [...new Set(messages.map(m => m.user_id).filter(Boolean))];
                    const usersMap = await getUsersByIds(thread.workspace_id, userIds);

                    const content = buildThreadContent(messages, usersMap);
                    const embedding = await generateEmbedding(content);


                    await upsertThreadEmbedding(
                        thread.workspace_id,
                        thread.channel_id,
                        thread.thread_ts,
                        content,
                        embedding,
                        messages.length
                    );

                    console.log(`✅ Thread ${thread.thread_ts} embedded — ${messages.length} message(s)`);

                } catch (threadError) {
                    console.error(`❌ Failed to embed thread ${thread.thread_ts}:`, threadError.message);
                }
            }

        } catch (error) {
            console.error('❌ Embedding scheduler error:', error);
        }
    });
}