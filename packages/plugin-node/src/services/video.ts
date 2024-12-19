import { Service } from "@ai16z/eliza";
import {
    IAgentRuntime,
    ITranscriptionService,
    Media,
    ServiceType,
    IVideoService,
} from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import youtubeDl from "youtube-dl-exec";

export class VideoService extends Service implements IVideoService {
    static serviceType: ServiceType = ServiceType.VIDEO;
    private cacheKey = "content/video";
    private dataDir = "./content_cache";

    private queue: string[] = [];
    private processing: boolean = false;
    private maxRetries = 3;

    constructor() {
        super();
        this.ensureDataDirectoryExists();
    }

    getInstance(): IVideoService {
        return VideoService.getInstance();
    }

    async initialize(_runtime: IAgentRuntime): Promise<void> {}

    private ensureDataDirectoryExists() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    public isVideoUrl(url: string): boolean {
        return (
            url.includes("youtube.com") ||
            url.includes("youtu.be") ||
            url.includes("vimeo.com") ||
            url.endsWith(".mp4") ||
            url.includes(".mp4?")
        );
    }

    public async downloadMedia(url: string): Promise<string> {
        const videoId = this.getVideoId(url);
        const outputFile = path.join(this.dataDir, `${videoId}.mp4`);

        if (fs.existsSync(outputFile)) {
            return outputFile;
        }

        try {
            await youtubeDl(url, {
                verbose: true,
                output: outputFile,
                format: "mp4",
            });
            return outputFile;
        } catch (error) {
            console.error("Error downloading media:", error);
            return outputFile; // Return the path even if download failed
        }
    }

    public async downloadVideo(videoInfo: any): Promise<string> {
        const videoId = this.getVideoId(videoInfo?.webpage_url || '');
        const outputFile = path.join(this.dataDir, `${videoId}.mp4`);

        if (fs.existsSync(outputFile)) {
            return outputFile;
        }

        try {
            await youtubeDl(videoInfo.webpage_url, {
                verbose: true,
                output: outputFile,
                format: "mp4",
            });
            return outputFile;
        } catch (error) {
            console.error("Error downloading video:", error);
            return outputFile; // Return the path even if download failed
        }
    }

    public async processVideo(
        url: string,
        runtime: IAgentRuntime
    ): Promise<Media> {
        return new Promise((resolve) => {
            this.queue.push(url);
            const checkQueue = async () => {
                const index = this.queue.indexOf(url);
                if (index !== -1) {
                    setTimeout(checkQueue, 100);
                } else {
                    try {
                        const result = await this.processVideoFromUrl(
                            url,
                            runtime
                        );
                        resolve(result);
                    } catch (error) {
                        console.error("Error in processVideo:", error);
                        resolve(this.createErrorMedia(url, error));
                    }
                }
            };
            this.processQueue(runtime);
            checkQueue();
        });
    }

    private async processQueue(runtime): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const url = this.queue.shift()!;
            try {
                await this.processVideoFromUrl(url, runtime);
            } catch (error) {
                console.error(`Error processing video ${url}:`, error);
                // Continue processing queue even if one video fails
            }
        }

        this.processing = false;
    }

    private createErrorMedia(url: string, error: any): Media {
        const videoId = this.getVideoId(url);
        return {
            id: videoId,
            url: url,
            title: "Processing Failed",
            source: "Error",
            description: "Failed to process video content",
            text: `Failed to process video content: ${error?.message || 'Unknown error'}. Please try again later.`,
        };
    }

    private async processVideoFromUrl(
        url: string,
        runtime: IAgentRuntime,
        retryCount = 0
    ): Promise<Media> {
        const videoId = url.match(
            /(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^\/&?]+)/
        )?.[1] || this.getVideoId(url);

        const cacheKey = `${this.cacheKey}/${videoId}`;

        try {
            const cached = await runtime.cacheManager.get<Media>(cacheKey);
            if (cached) {
                console.log("Returning cached video file");
                return cached;
            }

            console.log("Cache miss, processing video");
            const videoInfo = await this.fetchVideoInfo(url);
            const transcript = await this.getTranscript(url, videoInfo, runtime);

            const result: Media = {
                id: videoId,
                url: url,
                title: videoInfo?.title || "Unknown Title",
                source: videoInfo?.channel || videoInfo?.uploader || "Unknown Source",
                description: videoInfo?.description || "No description available",
                text: transcript || "No transcript available",
            };

            await runtime.cacheManager.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error(`Error processing video (attempt ${retryCount + 1}):`, error);

            if (retryCount < this.maxRetries) {
                console.log(`Retrying... (${retryCount + 1}/${this.maxRetries})`);
                return this.processVideoFromUrl(url, runtime, retryCount + 1);
            }

            const fallbackResult = this.createErrorMedia(url, error);
            await runtime.cacheManager.set(cacheKey, fallbackResult);
            return fallbackResult;
        }
    }

    private getVideoId(url: string): string {
        return stringToUuid(url || 'unknown-video');
    }

    async fetchVideoInfo(url: string): Promise<any> {
        if (url.endsWith(".mp4") || url.includes(".mp4?")) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    return {
                        title: path.basename(url),
                        description: "Direct video file",
                        channel: "Unknown Source",
                        webpage_url: url,
                        uploader: "Unknown Uploader",
                    };
                }
            } catch (error) {
                console.error("Error downloading MP4 file:", error);
            }
        }

        try {
            const result = await youtubeDl(url, {
                dumpJson: true,
                noCheckCertificates: true,
                preferFreeFormats: true,
                skipDownload: true,
            });
            return result;
        } catch (error) {
            console.warn("Video info fetch failed:", error.message);

            const videoId = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1];
            return {
                title: videoId ? `YouTube Video ${videoId}` : "Unknown Video",
                description: "Video information unavailable",
                channel: "Unknown Channel",
                webpage_url: url,
                uploader: "Unknown Uploader",
            };
        }
    }

    private async getTranscript(
        url: string,
        videoInfo: any,
        runtime: IAgentRuntime
    ): Promise<string> {
        try {
            // Try each method in sequence, falling back to the next if one fails
            try {
                if (videoInfo?.subtitles?.en) {
                    const srtContent = await this.downloadSRT(
                        videoInfo.subtitles.en[0].url
                    );
                    return this.parseSRT(srtContent);
                }
            } catch (error) {
                console.warn("Manual subtitles failed:", error);
            }

            try {
                if (videoInfo?.automatic_captions?.en) {
                    const captionUrl = videoInfo.automatic_captions.en[0].url;
                    const captionContent = await this.downloadCaption(captionUrl);
                    return this.parseCaption(captionContent);
                }
            } catch (error) {
                console.warn("Automatic captions failed:", error);
            }

            if (videoInfo?.categories?.includes("Music")) {
                return "No lyrics available for music video.";
            }

            return await this.transcribeAudio(url, runtime);
        } catch (error) {
            console.error("All transcript methods failed:", error);
            return "Transcript unavailable. The content could not be processed at this time.";
        }
    }

    private async downloadCaption(url: string): Promise<string> {
        console.log("Downloading caption from:", url);
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download caption: ${response.statusText}`);
            }
            return await response.text();
        } catch (error) {
            console.error("Caption download failed:", error);
            throw error;
        }
    }

    private parseCaption(captionContent: string): string {
        try {
            const jsonContent = JSON.parse(captionContent);
            if (jsonContent.events) {
                return jsonContent.events
                    .filter((event) => event.segs)
                    .map((event) => event.segs.map((seg) => seg.utf8).join(""))
                    .join(" ")
                    .replace(/\n/g, " ")
                    .trim();
            }
            return "Unable to parse captions: invalid format";
        } catch (error) {
            console.error("Caption parsing failed:", error);
            return "Unable to parse captions: parsing error";
        }
    }

    private parseSRT(srtContent: string): string {
        try {
            return srtContent
                .split("\n\n")
                .map((block) => block.split("\n").slice(2).join(" "))
                .join(" ")
                .replace(/\n/g, " ")
                .trim();
        } catch (error) {
            console.error("SRT parsing failed:", error);
            return "Unable to parse subtitles";
        }
    }

    private async downloadSRT(url: string): Promise<string> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download SRT: ${response.statusText}`);
            }
            return await response.text();
        } catch (error) {
            console.error("SRT download failed:", error);
            throw error;
        }
    }

    async transcribeAudio(
        url: string,
        runtime: IAgentRuntime
    ): Promise<string> {
        try {
            const mp4FilePath = path.join(
                this.dataDir,
                `${this.getVideoId(url)}.mp4`
            );

            const mp3FilePath = path.join(
                this.dataDir,
                `${this.getVideoId(url)}.mp3`
            );

            if (!fs.existsSync(mp3FilePath)) {
                if (fs.existsSync(mp4FilePath)) {
                    await this.convertMp4ToMp3(mp4FilePath, mp3FilePath);
                } else {
                    await this.downloadAudio(url, mp3FilePath);
                }
            }

            if (!fs.existsSync(mp3FilePath)) {
                throw new Error("Failed to prepare audio file");
            }

            const audioBuffer = fs.readFileSync(mp3FilePath);

            const transcriptionService = runtime.getService<ITranscriptionService>(
                ServiceType.TRANSCRIPTION
            );

            if (!transcriptionService) {
                throw new Error("Transcription service not available");
            }

            const transcript = await transcriptionService.transcribe(audioBuffer);
            return transcript || "Transcription produced no results";
        } catch (error) {
            console.error("Transcription failed:", error);
            return "Audio transcription failed. Please try again later.";
        }
    }

    private async convertMp4ToMp3(
        inputPath: string,
        outputPath: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .output(outputPath)
                .noVideo()
                .audioCodec("libmp3lame")
                .on("end", () => {
                    console.log("Conversion to MP3 complete");
                    resolve();
                })
                .on("error", (err) => {
                    console.error("Error converting to MP3:", err);
                    reject(err);
                })
                .run();
        });
    }

    private async downloadAudio(
        url: string,
        outputFile: string
    ): Promise<string> {
        try {
            if (url.endsWith(".mp4") || url.includes(".mp4?")) {
                const tempMp4File = path.join(
                    tmpdir(),
                    `${this.getVideoId(url)}.mp4`
                );

                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    fs.writeFileSync(tempMp4File, buffer);

                    await new Promise<void>((resolve, reject) => {
                        ffmpeg(tempMp4File)
                            .output(outputFile)
                            .noVideo()
                            .audioCodec("libmp3lame")
                            .on("end", () => {
                                try {
                                    fs.unlinkSync(tempMp4File);
                                } catch (e) {
                                    console.warn("Failed to cleanup temp file:", e);
                                }
                                resolve();
                            })
                            .on("error", reject)
                            .run();
                    });
                } finally {
                    if (fs.existsSync(tempMp4File)) {
                        try {
                            fs.unlinkSync(tempMp4File);
                        } catch (e) {
                            console.warn("Failed to cleanup temp file:", e);
                        }
                    }
                }
            } else {
                await youtubeDl(url, {
                    extractAudio: true,
                    audioFormat: "mp3",
                    output: outputFile,
                });
            }
            return outputFile;
        } catch (error) {
            console.error("Error downloading audio:", error);
            throw new Error(`Failed to download audio: ${error.message}`);
        }
    }
}