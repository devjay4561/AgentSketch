#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#include <stdlib.h>
#include <string.h>

char *agentsketch_vision_recognize(const char *path, int *result_code) {
    @autoreleasepool {
        *result_code = 0;
        if (@available(macOS 12.0, *)) {
            NSString *pathValue = [NSString stringWithUTF8String:path];
            NSURL *url = [NSURL fileURLWithPath:pathValue];
            VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
            request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
            request.usesLanguageCorrection = YES;

            NSError *languageError = nil;
            NSArray<NSString *> *supported = [request supportedRecognitionLanguagesAndReturnError:&languageError];
            if (languageError) {
                *result_code = 2;
                return strdup("");
            }
            NSMutableArray<NSString *> *languages = [NSMutableArray array];
            if ([supported containsObject:@"ko-KR"]) [languages addObject:@"ko-KR"];
            if ([supported containsObject:@"en-US"]) [languages addObject:@"en-US"];
            if (languages.count == 0) {
                *result_code = 2;
                return strdup("");
            }
            request.recognitionLanguages = languages;

            VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
            NSError *recognitionError = nil;
            if (![handler performRequests:@[request] error:&recognitionError]) {
                *result_code = 3;
                return strdup("");
            }
            NSMutableString *output = [NSMutableString string];
            for (VNRecognizedTextObservation *observation in request.results) {
                VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
                if (candidate.string.length == 0) continue;
                NSUInteger remaining = 50000 - output.length;
                if (remaining == 0) break;
                if (output.length > 0) [output appendString:@"\n"];
                [output appendString:[candidate.string substringToIndex:MIN(candidate.string.length, remaining)]];
                if (output.length >= 50000) break;
            }
            const char *utf8 = output.UTF8String ?: "";
            return strdup(utf8);
        }
        *result_code = 1;
        return strdup("");
    }
}
