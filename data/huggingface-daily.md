🤗 **Hugging Face 今日热门论文**
📅 2026年4月18日星期六

---

🥇 **HY-World 2.0: A Multi-Modal World Model for Reconstructing, Generating, and Simulating 3D Worlds**
   👍 68
   👥 Team HY-World, Chenjie Cao, Xuhui Zuo 等
   📄 [arXiv:2604.14268](https://arxiv.org/abs/2604.14268) | 🤗 [HF Paper](https://huggingface.co/papers/2604.14268) | 💻 [GitHub](https://github.com/Tencent-Hunyuan/HY-World-2.0)

   💭 最近读到一篇非常有趣的论文，是关于HY-World 2.0的，感觉你一定会很感兴趣。这项研究最核心的贡献在于打造了一个超级强大的多模态世界模型，你只需要输入一段文字、单张照片、多视角图像甚至是视频，它就能直接给你生成或重建出一个完整的3D世界。特别是当我们只给一句文本或单张图片时，它可以通过包含全景生成在内的四阶段方法，无中生有地合成出高保真且能自由漫游的3D高斯溅射（3DGS）场景。这项研究不仅把之前的1.0版本往前推进了一大步，而且应用前景特别广阔，未来不管是用来做VR/AR的沉浸式体验、游戏场景的快速搭建，还是自动驾驶的仿真测试，都非常实用，绝对值得一读！

🥈 **From P(y|x) to P(y): Investigating Reinforcement Learning in Pre-train Space**
   👍 24
   👥 Yuqiao Tan, Minzheng Wang, Bo Liu 等
   📄 [arXiv:2604.14142](https://arxiv.org/abs/2604.14142) | 🤗 [HF Paper](https://huggingface.co/papers/2604.14142) | 💻 [GitHub](https://github.com/Trae1ounG/Pretrain_Space_RLVR)

   💭 最近读了一篇特别有启发性的论文，叫《From P(y|x) to P(y)》，感觉你一定会很感兴趣。这篇文章的切入点非常巧妙，它指出目前主流的强化学习微调（RLVR）本质上只是在调整条件概率 P(y|x)，模型推理能力的上限其实早就被基座模型的分布锁死了。为了打破这个天花板，作者提出要把强化学习直接拉回预训练阶段，去优化更底层的边缘分布 P(y)。简单来说，就是让模型不再被动地死记硬背静态语料，而是在预训练的“出厂设置”阶段就主动把探索和推理能力刻在骨子里。这种思路不仅为大模型突破现有的推理瓶颈提供了一个全新的破局方向，未来在构建需要强大泛化和自主探索能力的通用智能体（Agent）时也极具应用潜力。如果你最近也在关注大模型底层推理能力的演进，这篇论文绝对值得花时间一看！

🥉 **Sema Code: Decoupling AI Coding Agents into Programmable, Embeddable Infrastructure**
   👍 23
   👥 Huacan Wang, Jie Zhou, Ningyan Zhu 等
   📄 [arXiv:2604.11045](https://arxiv.org/abs/2604.11045) | 🤗 [HF Paper](https://huggingface.co/papers/2604.11045) | 💻 [GitHub](https://github.com/midea-ai/sema-code-core)

   💭 最近读到了一篇挺有意思的论文《Sema Code》，感觉你一定会很感兴趣。这篇论文最核心的贡献在于，它打破了目前 AI 编程助手总是被死死“绑定”在特定 IDE、命令行或者网页里的局限，将 AI 的代码推理能力解耦成了一套可编程、可嵌入的底层基础设施。这对于企业级研发来说意义非常大，因为开发团队终于可以跨越复杂的异构工程环境，在任何需要的业务流或自研平台里无缝插拔和复用 AI 的编程能力，再也不用受制于单一工具的生态壁垒了。如果你平时关注 AI 研发工具或者企业级工程提效，这篇论文绝对值得花时间看一看，它为我们构建高度灵活的 AI 辅助开发环境提供了一个特别棒的新思路。

4️⃣ **Exploration and Exploitation Errors Are Measurable for Language Model Agents**
   👍 23
   👥 Jaden Park, Jungtaek Kim, Jongwon Jeong 等
   📄 [arXiv:2604.13151](https://arxiv.org/abs/2604.13151) | 🤗 [HF Paper](https://huggingface.co/papers/2604.13151) | 💻 [GitHub](https://github.com/jjj-madison/measurable-explore-exploit)

   💭 最近读到一篇挺有意思的论文，感觉你也会很感兴趣！这篇文章最核心的贡献在于，作者们提出了一种非常巧妙的方法，能够仅仅通过观察语言模型智能体（LM Agent）的外部行为，就系统地量化和区分它们在“探索未知”和“利用已知”时犯的错误，而不需要去获取模型内部的策略机制。为了验证这个方法，他们还专门设计了一套贴近真实场景的可控环境。这项研究的意义真的很大，现在大家都在搞AI编程或者具身智能，如果有了这种量化工具，以后我们在这些复杂的开放式任务中，就能更精准地评估和优化智能体的决策表现了。强烈推荐你有空读一读原文！

5️⃣ **RAD-2: Scaling Reinforcement Learning in a Generator-Discriminator Framework**
   👍 21
   👥 Hao Gao, Shaoyu Chen, Yifan Zhu 等
   📄 [arXiv:2604.15308](https://arxiv.org/abs/2604.15308) | 🤗 [HF Paper](https://huggingface.co/papers/2604.15308) | 💻 [GitHub](https://github.com/hustvl/RAD)

   💭 最近读到了一篇挺有意思的自动驾驶论文，推荐给你。这篇叫 RAD-2 的文章主要解决了目前基于扩散模型的轨迹规划器存在的一个痛点：虽然它们能很好地预测复杂的未来轨迹，但单纯用模仿学习训练会导致闭环测试时不稳定，而且缺乏纠错的负反馈机制。为此，作者们提出了一个统一的生成器-判别器框架，巧妙地将强化学习扩展应用到了这个架构中。这个研究的现实意义非常大，尤其是在高级别自动驾驶的运动规划场景下，它能让车辆在面对复杂、多变的真实路况时，不仅能预测出多种可能的未来走向，还能像“老司机”一样根据环境反馈及时纠正错误。如果你最近在关注端到端自动驾驶或者强化学习的实际落地，这篇论文的思路绝对值得一读。

---
_数据来源: [Hugging Face Daily Papers](https://huggingface.co/papers) | 评论由 AI 生成_