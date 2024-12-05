import {
    IAgentRuntime,
} from "@ai16z/eliza";

  export interface Message {
    id: string;
    groupId: string;
    userId: string;
    userName: string;
    message: string;
    createdOn: string;
    messageType: number;
    picture: string;
    isPinned: boolean;
    reactionsCount: number;
    attachments: any[];
    reactions: any[];
    // New fields for reply functionality
    replyId: string | null;
    reply?: {
        id: string;
        groupId: string;
        userId: string;
        userName: string;
        message: string;
        createdOn: string;
        messageType: number;
        picture: string;
        isPinned: boolean;
        reactionsCount: number;
        attachments: any[];
        replyId: string | null;
    } | null;
    user?: ArenaUser;
  }
  
  export interface ArenaUser {
    id: string;
    createdOn: string;
    twitterId: string;
    twitterHandle: string;
    twitterName: string;
    twitterPicture: string;
    lastLoginTwitterPicture: string;
    bannerUrl: string | null;
    address: string;
    addressBeforeDynamicMigration: string;
    dynamicAddress: string;
    ethereumAddress: string | null;
    solanaAddress: string | null;
    prevAddress: string;
    addressConfirmed: boolean;
    twitterDescription: string;
    signedUp: boolean;
    subscriptionCurrency: string;
    subscriptionCurrencyAddress: string | null;
    subscriptionPrice: string;
    keyPrice: string;
    lastKeyPrice: string;
    threadCount: number;
    followerCount: number;
    followingsCount: number;
    twitterFollowers: number;
    subscriptionsEnabled: boolean;
    userConfirmed: boolean;
    twitterConfirmed: boolean;
    flag: number;
    ixHandle: string;
    handle: string | null;
  }
  
  export interface Thread {
    displayStatus: number;
    content: string;
    language: string;
    threadType: string;
    userId: string;
    userName: string;
    userHandle: string;
    userPicture: string;
    privacyType: number;
    repostId: string | null;
    answerId: string | null;
    currencyAddress: string | null;
    id: string;
    contentUrl: string;
    createdDate: string;
    answerCount: number;
    likeCount: number;
    bookmarkCount: number;
    repostCount: number;
    isDeleted: boolean;
    answerPrivacyType: number;
    isPinned: boolean;
    paywall: boolean;
    price: string;
    tipAmount: number;
    tipCount: number;
    currency: string;
    currencyDecimals: number;
  }
  
  export interface GetMessagesResponse {
    messages: Message[];
  }
  
  export interface PostMessageResponse {
    message: Message;
  }
  
  export interface PostThreadResponse {
    thread: Thread;
  }
  
  export interface ThreadFeedResponse {
    threads: ThreadFeedItem[];
  }
  
  export interface ThreadFeedItem extends Thread {
    user_twitterHandle: string;
    user_twitterPicture: string;
    video_url: string | null;
    image_url: string | null;
    userLike_id: string | null;
    userReposted_id: string | null;
    userBookmarked_id: string | null;
    stage_id: string | null;
    stage_createdOn: string | null;
    stage_endedOn: string | null;
    stage_name: string | null;
    stage_hostId: string | null;
    stage_isActive: boolean | null;
    stage_isRecorded: boolean | null;
    stage_isRecordingComplete: boolean | null;
    stage_recordingUrl: string | null;
    stage_privacyType: number | null;
    postCount: number;
    hasPoll: boolean;
    user: {
      twitterHandle: string;
      twitterPicture: string;
    };
    images: Array<{ url: string }>;
    videos: any[];
    like: boolean;
    bookmark: boolean;
    reposted: boolean;
    stage: {
      id: string | null;
      createdOn: string | null;
      endedOn: string | null;
      name: string | null;
      hostId: string | null;
      isActive: boolean | null;
      isRecorded: boolean | null;
      isRecordingComplete: boolean | null;
      recordingUrl: string | null;
      privacyType: number | null;
    };
  }

  export interface ThreadReplyResponse {
    thread: ThreadReplyItem;
  }
  
  export interface ThreadReplyItem extends Thread {
    like: boolean | null;
    bookmark: boolean | null;
    reposted: boolean | null;
    repost: boolean | null;
    images: Array<{ url: string }>;
    videos: any[];
    stage: any | null;
    user: ArenaUser; 
  }

  export interface Notification {
    id: string;
    createdOn: string;
    userId: string;
    title: string;
    text: string;
    link: string;
    type: number;
    isSeen: boolean;
    isDeleted: boolean;
  }
  
  export interface NotificationsResponse {
    notifications: Notification[];
    numberOfPages: number;
    numberOfResults: number;
    pageSize: string;
  }
  
  // api.ts
  export class ArenaApiClient {
    private readonly baseUrl = 'https://api.starsarena.com';
    private readonly headers: HeadersInit;
  
    constructor(runtime?: IAgentRuntime) {
        const token = runtime?.getSetting("ARENA_BEARER_TOKEN") || process.env.ARENA_BEARER_TOKEN;
        
        if (!token) {
          throw new Error('ARENA_BEARER_TOKEN not found in environment or runtime settings');
        }
    
        this.headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };
    }
  
    private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
      const response = await fetch(url, {
        ...options,
        headers: this.headers
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} at ${url}`);
      }
  
      return response;
    }
  
    async getThreadFeed(page: number = 1, pageSize: number = 20, threadId?: string): Promise<ThreadFeedResponse> {
        try {
          const endpoint = threadId 
            ? `${this.baseUrl}/threads/nested?threadId=${threadId}`
            : `${this.baseUrl}/threads/feed/my?page=${page}&pageSize=${pageSize}`;
            
          const response = await this.fetchWithAuth(endpoint);
          return await response.json();
        } catch (error) {
          console.error('Error fetching thread feed:', error);
          throw error;
        }
    }
  
    async getAllThreads(maxPages: number = 5): Promise<ThreadFeedItem[]> {
      const allThreads: ThreadFeedItem[] = [];
      let currentPage = 1;
  
      try {
        while (currentPage <= maxPages) {
          const response = await this.getThreadFeed(currentPage);
          const { threads } = response;
  
          if (!threads || threads.length === 0) {
            break;
          }
  
          allThreads.push(...threads);
          currentPage++;
        }
  
        return allThreads;
      } catch (error) {
        console.error('Error fetching all threads:', error);
        throw error;
      }
    }
  
    async getMessages(groupId: string): Promise<GetMessagesResponse> {
      try {
        const response = await this.fetchWithAuth(
          `${this.baseUrl}/chat/messages/b?groupId=${groupId}`
        );
  
        return await response.json();
      } catch (error) {
        console.error('Error fetching messages:', error);
        throw error;
      }
    }
  
    async postMessage(groupId: string, text: string, files: any[] = []): Promise<PostMessageResponse> {
      try {
        const response = await this.fetchWithAuth(
          `${this.baseUrl}/chat/message`,
          {
            method: 'POST',
            body: JSON.stringify({
              groupId,
              files,
              text
            })
          }
        );
  
        return await response.json();
      } catch (error) {
        console.error('Error posting message:', error);
        throw error;
      }
    }
  
    async postThread(content: string, privacyType: number = 0, files: any[] = []): Promise<PostThreadResponse> {
      try {
        const response = await this.fetchWithAuth(
          `${this.baseUrl}/threads`,
          {
            method: 'POST',
            body: JSON.stringify({
              content: `<p>${content}</p>`,
              privacyType,
              files
            })
          }
        );
  
        return await response.json();
      } catch (error) {
        console.error('Error posting thread:', error);
        throw error;
      }
    }

    async replyToThread(threadId: string, content: string, userId?: string, files: any[] = []): Promise<ThreadReplyResponse> {
        try {
          const response = await this.fetchWithAuth(
            `${this.baseUrl}/threads/answer`,
            {
              method: 'POST',
              body: JSON.stringify({
                content: `<p>${content}</p>`,
                threadId,
                userId, // Optional - will use authenticated user's ID if not provided
                files
              })
            }
          );
      
          return await response.json();
        } catch (error) {
          console.error('Error replying to thread:', error);
          throw error;
        }
    }

    async getNotifications(page: number = 1, pageSize: number = 20): Promise<NotificationsResponse> {
        try {
          const response = await this.fetchWithAuth(
            `${this.baseUrl}/notifications?page=${page}&pageSize=${pageSize}`
          );
      
          return await response.json();
        } catch (error) {
          console.error('Error fetching notifications:', error);
          throw error;
        }
      }
      
      // Helper method to get all notifications across multiple pages
      async getAllNotifications(maxPages: number = 5): Promise<Notification[]> {
        const allNotifications: Notification[] = [];
        let currentPage = 1;
      
        try {
          while (currentPage <= maxPages) {
            const response = await this.getNotifications(currentPage);
            const { notifications, numberOfPages } = response;
      
            if (!notifications || notifications.length === 0) {
              break;
            }
      
            allNotifications.push(...notifications);
      
            if (currentPage >= numberOfPages) {
              break;
            }
      
            currentPage++;
          }
      
          return allNotifications;
        } catch (error) {
          console.error('Error fetching all notifications:', error);
          throw error;
        }
    }
  }