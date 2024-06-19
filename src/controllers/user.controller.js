import {asyncHandler} from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { deleteFromCLoudinary, deleteVideoFromCLoudinary, uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import { Otp } from "../models/otp.model.js";
import otpGenerator from "otp-generator";
import mongoose from "mongoose";
import {Subscription} from "../models/subscription.model.js";
import {Comment} from "../models/comment.model.js";
import { Like } from "../models/like.model.js";
import { Tweet } from "../models/tweet.model.js";
import { Video } from "../models/video.model.js";
import { Playlist } from "../models/playlist.model.js";


const deleteAllCommentsByUser = async(userId) => {
   
  // get all the comments by the user 

  const commentsByUser = await Comment.find({owner:userId});

  // delete all the likes on these comments comments

  commentsByUser.forEach(async (comment)=>{
   const commentId = comment._id;
   await Like.deleteMany({comment:commentId});
  });

  await Comment.deleteMany({owner:userId});

};

const deleteAllTweetByUser = async (userId) => {

   //get all the tweets by the user

   const tweetsByUser = await Tweet.find({owner:userId});

   // deleting all the likes on these tweets
   tweetsByUser.forEach( async (tweet) => {
      const tweetId = tweet._id;
      await Like.deleteMany({tweet:tweetId});
   })

   // deleting all the tweet

   await Tweet.deleteMany({owner:userId});
};


const deleteAllSubscriptionsOfUser = async (userId) => {

   await Subscription.deleteMany({
      $or:[{subscriber:userId},{channel:userId}]
   });
}

const deleteAllCommentsOnaVideo = async (videoId) => {
   // get all the comments on a video

  const commentsOnVideo = await Comment.find({video:videoId});

  // delete all the likes on these comments comments

  commentsOnVideo.forEach(async (comment)=>{
   const commentId = comment._id;
   await Like.deleteMany({comment:commentId});
  });

  await Comment.deleteMany({video:videoId});
}

const deleteAllLikesOnaVideo = async(videoId) => {
   await Like.deleteMany({video:videoId});
}

const deleteAllVideoByUser = async (userId) => {

   const allVideosOwnedByUser = await Video.find({owner: userId});

   allVideosOwnedByUser.forEach(async (video)=>{
      await deleteAllCommentsOnaVideo(video._id);
      await deleteAllLikesOnaVideo(video._id);

      await deleteFromCLoudinary(video.thumbnail);
      await deleteVideoFromCLoudinary(video.videoFile);
   });

   await Video.deleteMany({owner:userId});

   
} 

const deleteAllPlaylist = async (userId) => {
   await Playlist.deleteMany({owner:userId});
}

const generateAccessAndRefreshToken = async (userId) =>{
    try{

       const user = await User.findById(userId);
       const accessToken = user.generateAccessToken();
       const refreshToken = user.generateRefreshToken();

       user.refreshToken = refreshToken;
       await user.save({validateBeforeSave: false});
      
      return {accessToken,refreshToken};

    } catch (error) {
      throw new ApiError(500,"Something went wrong while generating access and refresh tokens");  
    }
}

const generateOtp = asyncHandler( async (req,res) => {
      
   // extract details from req.body

   const {email} = req.body;

   //basic validation

   if(!email){
      throw new ApiError(400,"email is required");
   }

   //generate an otp
   const otp = otpGenerator.generate(6);

   //create an entry in the database

   const generatedOtp = await Otp.create({
      email,
      otp
   })
  

   if(!generatedOtp){
      throw new ApiError(500, "Something went wrong while generating the otp");
   }

   return res 
          .status(200)
          .json(
               new ApiResponse(
                  200,
                  {},
                  "Otp generated successfully",
               )
          );

});

const registerUser = asyncHandler(async (req,res) => {

    // get user details from frontend
    const {fullName, email, username, password, otp} = req.body;

    
    
    // validations
    if([fullName,email,username,password, otp].some((field)=>{
       return field?.trim() === ""
    })){

        throw new ApiError(400,"All fields are required");
    }

    //can add more custom validations


    // check is user already exists

    const existingUser = await User.findOne({
        $or: [{ email },{ username }]
     });
    
     if(existingUser){
        throw new ApiError(409,"username or email is already registered")
     }
     
     // check if the otp is correct 

     const otpDocument = await Otp.find({email}).sort({createdAt: -1}).limit(1);

     if(!otpDocument){
         throw new ApiError(400,"Otp has expired");
     }

     if(otpDocument?.[0]?.otp !== otp){
         throw new ApiError(401, "Otp is invalid");
     }
    
    // check for images, check for avatar

    const avatarLocalFilePath = req.files?.avatar?.[0]?.path;
    const coverImageLocalFilePath = req.files?.coverImage?.[0]?.path;

    if(!avatarLocalFilePath){
        throw new ApiError(400,"Avatar file is required");
    }
    
    // upload them to cloudinary (store the reference)

    const avatar = await uploadOnCloudinary(avatarLocalFilePath);
    const coverImage = await uploadOnCloudinary(coverImageLocalFilePath);

    // check whether the avatar was uploaded to cloudinary

     if(!avatar){
        throw new ApiError(400,"Avatar file is required");
     }

    // create user object - create entry in db

    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        username: username.toLowerCase(),
        password
    });

    // check for user creation (may be unOptimal but it will make sure that there are no errors)
    // remove password and refresh token field from response

    const createdUser = await User.findById(user?._id).select(
        "-password -refreshToken"
     );

     if(!createdUser){
        throw new ApiError(500,"Something went wrong while creating a user");
    }

     // return response
    
     return res
            .status(201)
            .json(
               new ApiResponse(
                  201,
                  createdUser,
                  "User registered successfully"
               )
            );

});

const loginUser = asyncHandler(async (req,res) => {
     
   //   extract data from req.body
   const {email, username, password} = req.body;

   //   username or email
   if(!email && !username){
      throw new ApiError(400,"username or email is required");
   }

   //   find the user
  const user =  await User.findOne({
      $or:[{email},{username}]
   });
   
   if(!user){
      throw new ApiError(404,"User does not exists");
   }

    //   compare the password
   const isPasswordValid = await user.isPasswordCorrect(password);

   if(!isPasswordValid){
      throw new ApiError(401,"Invalid user credentials");
   }

   //   access and refresh token generation
   const {accessToken, refreshToken} = await generateAccessAndRefreshToken(user._id);

   
   const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

   //send cookies

   const options = {
      httpOnly:true,
      secure: true,
   }

   return res
          .status(200)
          .cookie("accessToken",accessToken, options)
          .cookie("refreshToken",refreshToken, options)
          .json(
            new ApiResponse(
               200,
               {
                  user:loggedInUser,
                  accessToken, 
                  refreshToken
               },
               "User logged In Successfully"
            )
          );
});


const logoutUser  = asyncHandler(async (req,res) => {
   
   await User.findByIdAndUpdate(
      req.user._id,
      {
         $set: {
            refreshToken: ""
         }
      },
      {
         new: true,
      }
   );

   const options = {
      httpOnly: true,
      secure: true,
   }

   return res
          .status(200)
          .clearCookie("accessToken",options)
          .clearCookie("refreshToken",options)
          .json(
               new ApiResponse(
                  200,
                  {},
                  "User logged Out"
               )
          )
});


const refreshAccessToken = asyncHandler(async (req, res) => {
   
   const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

   if(!incomingRefreshToken) {
      throw new ApiError(401, "unauthorized request");
   }

    try {
      const decodedToken = jwt.verify(
        incomingRefreshToken,
        process.env.REFRESH_TOKEN_SECRET
     );
  
     const user = await User.findById(decodedToken?._id);
     
     if(!user){
        throw new ApiError(401,"Invalid refresh token");
     }
  
     if(incomingRefreshToken !== user?.refreshToken){
        throw new ApiError(401,"Refresh token exprired or used ");
     }
  
     const {accessToken, refreshToken} = await generateAccessAndRefreshToken(user?._id);
  
     const options = {
        httpOnly: true,
        secure: true,
     }
  
     return res 
            .status(200)
            .cookie('accessToken',accessToken,options)
            .cookie('refreshToken',refreshToken,options)
            .json(
              new ApiResponse(
                 200,
                 {
                    accessToken,
                    refreshToken,
                 },
                 "Access token refreshed"
              )
            );
  
    } catch (error) {
       throw new ApiError(401,error?.message || "Invalid refresh token");
    }

});

const changeCurrentPassord = asyncHandler(async (req,res) => {

   const {oldPassword, newPassword} = req.body;

   const user = await User.findById(req.user?._id);
   const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

   if(!isPasswordCorrect){
      throw new ApiError(400, "Invalid password");
   }

   user.password = newPassword;

   user.save({validateBeforeSave:false});

   return res
          .status(200)
          .json(
            new ApiResponse(
               200,
               {},
               "Password changed successfully",
            )
          );

});

const getCurrentUser = asyncHandler(async (req, res) => {

   return res
          .status(200)
          .json(
               new ApiResponse(
                  200,
                  req.user,
                  "User fetched successfully"
               )
          );
})

//is you are updating a file make sure to do it in a different controller

const updateAccountDetails = asyncHandler(async (req,res) => {

   const {fullName} = req.body;

   if(!fullName){
      throw new ApiError(406, "All fields are required")
   }

   const user = await User
                     .findByIdAndUpdate(
                        req.user?._id,
                        {
                           $set: {
                              fullName
                           }
                        },
                        {
                           new: true,
                        }
                     )
                     .select(
                        "-password -refreshToken"
                     )
   return res
          .status(200)
          .json(
               new ApiResponse(
                  200,
                  user,
                  "Account Details updated successfully"
               )
          );

});

const updateEmail = asyncHandler(async (req,res) => {
   const {email,otp} = req.body;

   if(!email){
      throw new ApiError(406, "email is required");
   }

   const otpInDB =  await Otp.find({email}).sort({createdAt:-1}).limit(1);

   if(!otpInDB){
      throw new ApiError(400, "Otp has expired");
   }

   if(otpInDB?.[0]?.otp !== otp){
      throw new ApiError(403,"Inavlid otp");
   }

   const user = await User
                     .findByIdAndUpdate(
                        req.user?._id,
                        {
                           $set: {
                              email,
                           }
                        },
                        {
                           new: true,
                        }
                     );
   
   if(!user){
      throw new ApiError(500,"Something went wrong while updating the user in DB");
   }

   return res 
          .status(200)
          .json(
            new ApiResponse(
               200,
               {},
               "Email updated",
            )
          );

})

const updateUserAvatar = asyncHandler(async (req,res) => {

   const avatarLocalFilePath = req.file?.path;

   if(!avatarLocalFilePath){
      throw new ApiError(400, "Avtar file is missing");
   }

   //uploading avatar on cloudianry
   const avatar = await uploadOnCloudinary(avatarLocalFilePath);
   
   if(!avatar.url){
      throw new ApiError(500, "Error while uploading the avatar on cloudinary");
   }

   //deleting previous avatar image
   await deleteFromCLoudinary(req.user?.avatar);

   const user = await User
                     .findByIdAndUpdate(
                        req.user?._id,
                        {
                           $set:{
                              avatar:avatar.url
                           }
                        },
                        {
                           new:true,
                        }
                     )
                     .select(
                        "-password -refreshToken"
                     );
   
   return res
          .status(200)
          .json(
             new ApiResponse(
               200,
               user,
               "User avatar updated successfully",
            )
          );

});

const updateUserCoverImage = asyncHandler(async (req,res) => {

   const coverImageLocalFilePath = req.file?.path;

   if(!coverImageLocalFilePath){
      throw new ApiError(400, "CoverImage file is missing");
   }

   //uploading new image on cloudinary
   const coverImage = await uploadOnCloudinary(coverImageLocalFilePath);
   
   if(!coverImage.url){
      throw new ApiError(500, "Error while uploading the coverImage on cloudinary");
   }

   //delete the previous coverImage form cloudinary
   await deleteFromCLoudinary(req.user?.coverImage);

   const user = await User
                     .findByIdAndUpdate(
                        req.user?._id,
                        {
                           $set:{
                              coverImage:coverImage.url
                           }
                        },
                        {
                           new:true,
                        }
                     )
                     .select(
                        "-password -refreshToken"
                     );
   
   return res
          .status(200)
          .json(
             new ApiResponse(
               200,
               user,
               "User CoverImage updated successfully",
            )
          );

});


const getUserChannelProfile = asyncHandler(async (req,res) => {

   const {username} = req.params;

   if(!username?.trim()){
      throw new ApiError(400, "username is missing");
   }

   const channel = await User.aggregate([
         {
            $match: {
               username: username?.toLowerCase()?.trim()
            }
         },
        {
           $lookup: {
               from:"subscriptions",
               localField: "_id",
               foreignField: "channel",
               as: "subscribers",
           }
        },
        {
          $lookup: {
            from: "subscription",
            localField: "_id",
            foreignField:"subscriber",
            as:"subscribedTo"
          }
        },
        {
         $addFields:{
            subscribersCount: {
               $size: "$subscribers",
            },
            channelsSubscribedToCount: {
               $size: "$subscribedTo",
            },
            isSubscribed: {
               $cond: {
                  if: {$in : [req.user?._id, "$subscribers.subscriber"]},
                  then :true,
                  else : false
               }
            }
         }
        },
        {
               $project: {
                  fullName: 1,
                  username: 1,
                  subscribersCount: 1,
                  channelsSubscribedToCount: 1,
                  isSubscribed : 1,
                  avatar: 1,
                  coverImage: 1,
                  email: 1,
                  _id:1
               }
        }
   ])


   if(!channel?.length){
      throw new ApiError(404, "channel does not exists");
   }

   return res
          .status(200)
          .json(
            new ApiResponse(
               200,
               channel[0],
               "User channel info fetched successfully"
            )
          );

});


const getWatchHistory =  asyncHandler(async (req, res) => {
   const user = await User.aggregate([
      {
         $match: {
            _id: new mongoose.Types.ObjectId(req.user._id)
         }
      },
      {
         $lookup:{
            from: 'videos',
            localField:"watchHistory",
            foreignField: "_id",
            as: "watchHistory",
            pipeline: [
               {
                  $lookup:{
                     from: "users",
                     localField:"owner",
                     foreignField:"_id",
                     as:"owner",
                     pipeline: [
                        {
                           $project: {
                              fullName: 1,
                              username: 1,
                              avatar: 1,
                           }
                        }
                     ]
                  },

               },
               {
                  $addFields:{
                     owner:{
                        $first: "$owner"
                     }
                  }

               }
            ]

            
         }
      }
   ]);

   return res 
          .status(200)
          .json(
            new ApiResponse(
               200,
               user[0].watchHistory,
               "Watch history fetched successfully",
            )
          );
});


const deleteUser = asyncHandler(async (req, res) => {

   const {otp} = req.body;
   

   if(!otp){
      throw new ApiError(401,"otp is required");
   }

   const otpInDB = await Otp.find({email:req.user.email}).sort({createdAt: -1}).limit(1);

   if(!otpInDB?.[0]?.otp){
      throw new ApiError(403,"The otp has expired");
   }


   if(otpInDB[0].otp !== otp){
      throw new ApiError(403,"Otp is invalid");
   }


   await deleteAllCommentsByUser(req.user._id);
   await deleteAllTweetByUser(req.user._id);
   await deleteAllSubscriptionsOfUser(req.user._id);
   await deleteAllVideoByUser(req.user._id);
   await deleteAllPlaylist(req.user._id);


   await deleteFromCLoudinary(req.user.avatar);
   await deleteFromCLoudinary(req.user.coverImage);

   await User.findByIdAndDelete(req.user._id);
  

  
  return res 
         .status(200)
         .json(
               new ApiResponse(
                  200,
                  {

                  },
                  "user data deleted",
               )
         );


});

export {
   registerUser,
   loginUser,
   logoutUser,
   refreshAccessToken,
   changeCurrentPassord,
   getCurrentUser,
   updateAccountDetails,
   updateUserAvatar,
   updateUserCoverImage,
   generateOtp,
   updateEmail,
   getUserChannelProfile,
   getWatchHistory,
   deleteUser,
};



